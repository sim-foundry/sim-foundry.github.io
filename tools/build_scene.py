"""Build hybrid-viewer assets and manifest for one OmniGibson scene.

Auto-discovers the scene state JSON and background PLY under
`controllable-digital-cousins/assets/scenes/<scene>/`, runs `usd_to_glb.py` on
every object USD referenced, and writes:

    sim-foundry-website/assets/viewers/<scene>/
        scene.json                       # manifest the viewer fetches
        objects/<category>_<variant>.glb # one GLB per unique object USD
        <ply-basename>.ply               # symlinked from the source

The PLY is gitignored locally (large) and expected to be hosted on the
sim-foundry-website-assets Release that matches `--release-tag`.

USD paths inside the scene state JSON often point at the original capture
machine's filesystem (e.g. `/home/wpai/.../assets/scenes/<scene>/...`); this
script rewrites those to the local scene root so the converter can resolve
them.

Run inside the `sam3d` env (which has `pxr`, `trimesh`, `PIL`):
    /home/cdc/miniforge3/envs/sam3d/bin/python tools/build_scene.py --scene kitchen_2
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
from usd_to_glb import convert as usd_to_glb_convert  # noqa: E402

SOURCE_SCENES_ROOT = Path("/home/cdc/controllable-digital-cousins/assets/scenes")
SOURCE_VIDEO_ROOT = Path("/home/cdc/controllable-digital-cousins/Data/Scene_Video")
WEBSITE_DIR = THIS_DIR.parent

# Anything matching this prefix in the scene state JSON's usd_path values gets
# rewritten to the local scene dir. Captures the trailing `assets/scenes/`.
FOREIGN_SCENE_PATH_RE = re.compile(
    r"^/home/[^/]+/controllable-digital-cousins[_a-zA-Z0-9-]*/assets/scenes/"
)
LOCAL_SCENES_PREFIX = "/home/cdc/controllable-digital-cousins/assets/scenes/"

# Object poses come from `_scene_state_latest.json`. If that file lacks the
# `gs_background` entry (the splat transform), we additionally consult
# `_scene_state_latest_with_gs.json` and pull just gs_background from there.
PRIMARY_STATE_NAME = "{scene}_scene_state_latest.json"
GS_FALLBACK_STATE_NAME = "{scene}_scene_state_latest_with_gs.json"


def _find_state_json(scene_dir: Path, scene: str) -> Path:
    primary = scene_dir / PRIMARY_STATE_NAME.format(scene=scene)
    if primary.exists():
        return primary
    # Fall back to any *_scene_state*.json, newest first
    matches = sorted(scene_dir.glob(f"{scene}_scene_state*.json"),
                     key=lambda p: p.stat().st_mtime, reverse=True)
    if matches:
        return matches[0]
    raise FileNotFoundError(f"No scene state JSON under {scene_dir}")


def _load_gs_background_fallback(scene_dir: Path, scene: str):
    """If the primary state JSON has no gs_background, try the _with_gs sibling.

    Returns (init_args_dict, root_link_dict) or (None, None) if not found.
    """
    fb = scene_dir / GS_FALLBACK_STATE_NAME.format(scene=scene)
    if not fb.exists():
        return None, None
    with open(fb) as f:
        d = json.load(f)
    init = d.get("objects_info", {}).get("init_info", {}).get("gs_background")
    state = d.get("state", {}).get("registry", {}).get("object_registry", {}).get("gs_background")
    if not init or not state:
        return None, None
    return init.get("args", {}), state.get("root_link", {})


def _find_ply(scene_dir: Path) -> Path:
    bg_dir = scene_dir / "background_3dgs"
    if not bg_dir.exists():
        raise FileNotFoundError(f"No background_3dgs/ under {scene_dir}")
    plys = sorted(bg_dir.glob("*.ply"))
    if not plys:
        raise FileNotFoundError(f"No .ply under {bg_dir}")
    return plys[0]


def _find_source_video(scene: str) -> Path | None:
    """Look for a source video matching the scene under SOURCE_VIDEO_ROOT.

    Tries `<scene>.MOV`, `<scene>.mov`, plus the same with the `_demo` suffix
    stripped (so `kitchen_2_demo` matches `kitchen_2.MOV`).
    """
    candidates = [scene]
    if scene.endswith("_demo"):
        candidates.append(scene[: -len("_demo")])
    for stem in candidates:
        for ext in ("MOV", "mov", "mp4", "MP4"):
            p = SOURCE_VIDEO_ROOT / f"{stem}.{ext}"
            if p.exists():
                return p
    return None


def _transcode_video(src: Path, dst: Path, max_width: int = 640) -> None:
    """Transcode a source MOV/MP4 to a small web-friendly MP4.

    H.264 baseline, scaled to `max_width`, CRF 28, no audio, fast-start
    (moov atom at the front so it can play before the full file downloads).
    """
    import subprocess
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(src),
        "-vf", f"scale={max_width}:-2",
        "-c:v", "libx264", "-preset", "fast", "-crf", "28",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        str(dst),
    ]
    subprocess.run(cmd, check=True)


def _remap_path(path_str: str, scene_dir: Path) -> str:
    """Resolve a USD path string into a local absolute path.

    Handles three forms found across scene state JSONs:
      - Foreign absolute (`/home/wpai/.../assets/scenes/<scene>/...`)
      - Local absolute  (`/home/cdc/.../assets/scenes/<scene>/...`)
      - Relative        (`objects/foo/bar.usd` or `../../mesh_backgrounds/...`)
    """
    if not path_str:
        return path_str
    if FOREIGN_SCENE_PATH_RE.match(path_str):
        return FOREIGN_SCENE_PATH_RE.sub(LOCAL_SCENES_PREFIX, path_str)
    p = Path(path_str)
    if p.is_absolute():
        return str(p)
    # Relative — anchor at the scene dir
    return str((scene_dir / p).resolve())


def _glb_filename(usd_path: Path) -> str:
    """Derive a unique GLB name from the .../objects/<cat>/<variant>/usd/<variant>.usd layout.

    Some categories have very long descriptive names (>200 chars). Truncate the
    category portion of the basename so the resulting filename fits comfortably
    in a URL and in filesystem limits.
    """
    variant = usd_path.parent.parent.name
    category = usd_path.parent.parent.parent.name
    if len(category) > 60:
        category = category[:60].rstrip("_")
    return f"{category}_{variant}.glb"


def _root_link_pose(obj_state: dict) -> tuple[list[float], list[float]]:
    rl = obj_state["root_link"]
    return list(rl["pos"]), list(rl["ori"])


def build(scene: str, force: bool, release_tag: str, state_json: Path | None = None) -> None:
    scene_dir = SOURCE_SCENES_ROOT / scene
    if state_json is not None:
        state_path = state_json if state_json.is_absolute() else scene_dir / state_json
        if not state_path.exists():
            raise FileNotFoundError(f"--state-json not found: {state_path}")
    else:
        state_path = _find_state_json(scene_dir, scene)
    ply_path = _find_ply(scene_dir)
    ply_basename = ply_path.name

    print(f"scene:        {scene}")
    print(f"state json:   {state_path.name}")
    print(f"splat ply:    {ply_path.relative_to(scene_dir)} ({ply_path.stat().st_size // (1024*1024)} MB)")

    out_dir = WEBSITE_DIR / "assets" / "viewers" / scene
    objects_dir = out_dir / "objects"
    out_dir.mkdir(parents=True, exist_ok=True)
    objects_dir.mkdir(parents=True, exist_ok=True)

    with open(state_path) as f:
        sstate = json.load(f)

    init_info = sstate["objects_info"]["init_info"]
    object_states = sstate["state"]["registry"]["object_registry"]
    viewer_cam = sstate.get("viewer_camera_state", {})

    objects_out = []
    converted_cache: dict[str, str] = {}

    for name, info in init_info.items():
        # Skip the robot, the splat container, and the legacy SAM3D background
        # mesh — the splat replaces the latter on the web.
        if name in ("robot0", "gs_background") or name.startswith("mesh_background"):
            continue
        args = info.get("args", {})
        usd_str = _remap_path(args.get("usd_path", ""), scene_dir)
        if not usd_str:
            continue
        usd_path = Path(usd_str)
        if not usd_path.exists():
            print(f"  [warn] missing USD for {name}: {usd_path}")
            continue

        glb_name = _glb_filename(usd_path)
        glb_path = objects_dir / glb_name
        rel_url = f"assets/viewers/{scene}/objects/{glb_name}"

        if usd_str in converted_cache:
            pass
        elif glb_path.exists() and not force:
            print(f"  [skip] {glb_name}")
            converted_cache[usd_str] = rel_url
        else:
            print(f"  [conv] {usd_path.name} -> {glb_name}")
            try:
                usd_to_glb_convert(usd_path, glb_path)
                converted_cache[usd_str] = rel_url
            except Exception as e:
                print(f"  [err ] {glb_name}: {type(e).__name__}: {e}")
                continue

        pos, ori = _root_link_pose(object_states[name])
        scale = args.get("scale", [1.0, 1.0, 1.0])
        if isinstance(scale, (int, float)):
            scale = [float(scale)] * 3
        objects_out.append({
            "name": name,
            "category": args.get("category", name.split("_")[0]),
            "url": rel_url,
            "position": pos,
            "quaternion_xyzw": ori,
            "scale": [float(s) for s in scale],
        })

    # gs_background → splat transform. Prefer the primary state JSON; fall
    # back to the *_with_gs sibling if the primary doesn't carry it (nv_desk
    # case where the latest checkpoint didn't include the GS object).
    splat = None
    gs_args = None
    gs_root_link = None
    if "gs_background" in init_info and "gs_background" in object_states:
        gs_args = init_info["gs_background"].get("args", {})
        gs_root_link = object_states["gs_background"].get("root_link", {})
        gs_source = "primary"
    else:
        gs_args, gs_root_link = _load_gs_background_fallback(scene_dir, scene)
        gs_source = "fallback (_with_gs)" if gs_args else None

    if gs_args and gs_root_link:
        gs_scale = gs_args.get("scale", [1.0, 1.0, 1.0])
        if isinstance(gs_scale, (int, float)):
            gs_scale = [float(gs_scale)] * 3
        gs_pos = list(gs_root_link["pos"])
        gs_ori = list(gs_root_link["ori"])
        # Production fetches a gltfpack-style compressed .ksplat from
        # sim-foundry-website-assets via raw.githubusercontent.com (CORS
        # works there; release-asset CDN does not return CORS headers).
        # Locally, the same .ksplat file is dropped next to the PLY for dev.
        ksplat_basename = Path(ply_basename).with_suffix(".ksplat").name
        ksplat_raw_url = (
            f"https://raw.githubusercontent.com/sim-foundry/"
            f"sim-foundry-website-assets/main/splats/"
            f"{scene}__{ksplat_basename}"
        )
        splat = {
            "url": ksplat_raw_url,
            "format": "ksplat",
            "local_url": f"assets/viewers/{scene}/{ksplat_basename}",
            "position": gs_pos,
            "quaternion_xyzw": gs_ori,
            "scale": [float(s) for s in gs_scale],
        }
        print(f"  splat transform: from {gs_source}")

    camera = None
    if viewer_cam.get("position") and viewer_cam.get("orientation"):
        camera = {
            "position": [float(x) for x in viewer_cam["position"]],
            "quaternion_xyzw": [float(x) for x in viewer_cam["orientation"]],
        }

    # Look for a matching source capture video and transcode to a small,
    # browser-friendly MP4 that the viewer can play as a corner overlay.
    preview_video = None
    src_video = _find_source_video(scene)
    if src_video is not None:
        dst_video = out_dir / "preview.mp4"
        if dst_video.exists() and not force:
            print(f"  preview video: {dst_video.name} (cached)")
        else:
            print(f"  preview video: transcoding {src_video.name} -> {dst_video.name}")
            try:
                _transcode_video(src_video, dst_video)
            except Exception as e:
                print(f"  [warn] preview video transcode failed: {e}")
                dst_video = None
        if dst_video and dst_video.exists():
            preview_video = {
                "url": f"assets/viewers/{scene}/preview.mp4",
                "playback_rate": 1.5,
            }
    else:
        print(f"  preview video: no match for `{scene}` under {SOURCE_VIDEO_ROOT}")

    manifest = {
        "version": 1,
        "scene": scene,
        "world_up": [0.0, 0.0, 1.0],
        "splat": splat,
        "objects": objects_out,
        "camera": camera,
        "preview_video": preview_video,
    }
    manifest_path = out_dir / "scene.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nwrote {manifest_path}")
    print(f"  objects: {len(objects_out)} (from {len(converted_cache)} unique USDs)")
    print(f"  splat:   {splat['url'] if splat else 'none'}")
    print(f"  camera:  {'set' if camera else 'unset'}")

    # Symlink the source PLY for local dev
    local_ply = out_dir / ply_basename
    if local_ply.is_symlink() or local_ply.exists():
        local_ply.unlink()
    os.symlink(ply_path, local_ply)
    print(f"  ply link: {local_ply} -> {ply_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", required=True, help="Scene directory name under assets/scenes/")
    ap.add_argument("--force", action="store_true")
    ap.add_argument(
        "--release-tag", default="v0.1-scenes",
        help="GitHub Release tag the production splat PLY is attached to",
    )
    ap.add_argument(
        "--state-json", type=Path, default=None,
        help="Override the scene state JSON (absolute path or filename relative "
             "to the scene dir). Default: discover *_scene_state_latest.json.",
    )
    args = ap.parse_args()
    build(args.scene, args.force, args.release_tag, args.state_json)
