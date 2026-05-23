"""Build the nv_desk hybrid-viewer assets and manifest.

Reads the canonical OmniGibson scene state at
`assets/scenes/nv_desk/nv_desk_scene_state_latest_with_gs.json` from the
controllable-digital-cousins repo and produces:

    sim-foundry-website/assets/viewers/nv_desk/
        scene.json                       # manifest the viewer fetches
        objects/<category>_<variant>.glb # one GLB per unique object USD
        nv_desk_bg.ply                   # symlinked from the source dir

Big files (PLY > 100 MB) are gitignored locally and uploaded to
`sim-foundry/sim-foundry-website-assets` Releases for production hosting.

Run inside the `sam3d` env (which has `pxr`, `trimesh`, `PIL`):
    /home/cdc/miniforge3/envs/sam3d/bin/python tools/build_nv_desk_scene.py
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
from usd_to_glb import convert as usd_to_glb_convert  # noqa: E402

SOURCE_SCENE_DIR = Path("/home/cdc/controllable-digital-cousins/assets/scenes/nv_desk")
SCENE_STATE_JSON = SOURCE_SCENE_DIR / "nv_desk_scene_state_latest_with_gs.json"
SOURCE_PLY = SOURCE_SCENE_DIR / "background_3dgs" / "nv_desk_bg.ply"

WEBSITE_DIR = THIS_DIR.parent
OUT_DIR = WEBSITE_DIR / "assets" / "viewers" / "nv_desk"
OBJECTS_DIR = OUT_DIR / "objects"
MANIFEST_PATH = OUT_DIR / "scene.json"
LOCAL_PLY_PATH = OUT_DIR / "nv_desk_bg.ply"

# URL the published manifest will point to for the PLY. Override with --ply-url.
DEFAULT_PLY_URL = (
    "https://github.com/sim-foundry/sim-foundry-website-assets/releases/"
    "download/v0.1-nv-desk/nv_desk_bg.ply"
)


def _glb_filename(usd_path: Path) -> str:
    """Derive a unique GLB name from the USD's category/variant directory layout.

    Path shape: .../objects/<category>/<variant_hash>/usd/<variant_hash>.usd
    Output:     <category>_<variant_hash>.glb
    """
    variant = usd_path.parent.parent.name
    category = usd_path.parent.parent.parent.name
    return f"{category}_{variant}.glb"


def _root_link_pose(obj_state: dict) -> tuple[list[float], list[float]]:
    rl = obj_state["root_link"]
    return list(rl["pos"]), list(rl["ori"])


def build(scene_state_path: Path, force: bool, ply_url: str) -> None:
    with open(scene_state_path) as f:
        scene = json.load(f)

    init_info = scene["objects_info"]["init_info"]
    object_states = scene["state"]["registry"]["object_registry"]
    viewer_cam = scene.get("viewer_camera_state", {})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OBJECTS_DIR.mkdir(parents=True, exist_ok=True)

    objects_out = []
    converted_cache: dict[str, str] = {}  # usd_path -> glb relative url

    for name, info in init_info.items():
        # Skip the robot (no per-arm USD; would need URDF + meshes pipeline).
        if name == "robot0":
            continue

        args = info.get("args", {})
        usd_path_str = args.get("usd_path")
        if not usd_path_str:
            continue

        # gs_background is the splat scene container, not a normal mesh object.
        if name == "gs_background":
            continue

        usd_path = Path(usd_path_str)
        if not usd_path.exists():
            print(f"  [warn] missing USD for {name}: {usd_path}")
            continue

        glb_name = _glb_filename(usd_path)
        glb_path = OBJECTS_DIR / glb_name
        rel_url = f"assets/viewers/nv_desk/objects/{glb_name}"

        if usd_path_str in converted_cache:
            # Same USD already converted under a different object instance.
            pass
        elif glb_path.exists() and not force:
            print(f"  [skip] {glb_name} (exists)")
            converted_cache[usd_path_str] = rel_url
        else:
            print(f"  [conv] {usd_path.name} -> {glb_name}")
            usd_to_glb_convert(usd_path, glb_path)
            converted_cache[usd_path_str] = rel_url

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

    # Splat (gs_background): the PLY needs the same pose+scale OmniGibson
    # applied to the USDZ wrapper to land it in world frame next to the
    # foreground objects.
    if "gs_background" in init_info and "gs_background" in object_states:
        gs_args = init_info["gs_background"]["args"]
        gs_scale = gs_args.get("scale", [1.0, 1.0, 1.0])
        if isinstance(gs_scale, (int, float)):
            gs_scale = [float(gs_scale)] * 3
        gs_pos, gs_ori = _root_link_pose(object_states["gs_background"])
        splat = {
            "url": ply_url,
            "format": "ply",
            "local_url": "assets/viewers/nv_desk/nv_desk_bg.ply",
            "position": gs_pos,
            "quaternion_xyzw": gs_ori,
            "scale": [float(s) for s in gs_scale],
        }
    else:
        splat = None

    camera = None
    if viewer_cam.get("position") and viewer_cam.get("orientation"):
        camera = {
            "position": [float(x) for x in viewer_cam["position"]],
            "quaternion_xyzw": [float(x) for x in viewer_cam["orientation"]],
        }

    manifest = {
        "version": 1,
        "world_up": [0.0, 0.0, 1.0],
        "splat": splat,
        "objects": objects_out,
        "camera": camera,
    }

    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nWrote {MANIFEST_PATH}")
    print(f"  splat: {splat['url'] if splat else 'none'}")
    print(f"  objects: {len(objects_out)} (from {len(converted_cache)} unique USDs)")
    print(f"  camera: {'set' if camera else 'unset'}")

    # Symlink the source PLY into the website asset dir for local dev. The
    # gitignore keeps it from being committed; production points at the
    # Release URL via splat.url.
    if SOURCE_PLY.exists():
        if LOCAL_PLY_PATH.is_symlink() or LOCAL_PLY_PATH.exists():
            LOCAL_PLY_PATH.unlink()
        os.symlink(SOURCE_PLY, LOCAL_PLY_PATH)
        print(f"  ply symlink: {LOCAL_PLY_PATH} -> {SOURCE_PLY}")
    else:
        print(f"  [warn] source PLY not found at {SOURCE_PLY}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene-state", type=Path, default=SCENE_STATE_JSON)
    ap.add_argument("--force", action="store_true", help="Re-convert even if GLB exists")
    ap.add_argument(
        "--ply-url",
        type=str,
        default=DEFAULT_PLY_URL,
        help="URL the published manifest will reference for the splat PLY",
    )
    args = ap.parse_args()
    build(args.scene_state, args.force, args.ply_url)
