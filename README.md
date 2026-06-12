# SimFoundry — Research Website

Static research project page for the [sim-foundry](https://github.com/sim-foundry) GitHub organization. Layout is modeled on [PointWorld](https://point-world.github.io) with 3D viewer placeholders modeled on [PolaRiS](https://polaris-evals.github.io).

## File layout

```
index.html              # main page
static/css/index.css    # all styles
static/js/viewers.js    # 3D viewer wiring (lazy-loads three.js + splat lib)
static/js/scatter-chart.js  # sim-vs-real scatter plot
static/images/          # favicon and any static images
videos/                 # policy / task-cousin / real2sim eval videos
qual_videos/<scene>/    # qualitative result videos grouped by scene
glb/                    # SAM3D comparison meshes (meshopt-compressed)
splats/                 # Gaussian-splat backgrounds (.ksplat)
assets/viewers/         # per-scene manifests + object GLBs for the 3D viewers
tools/                  # scene build + asset optimization tooling
```

Everything is served same-origin from this repo (no external asset host).
Tracked content is ~500 MB — keep an eye on the 1 GB GitHub Pages limit when
adding media, and run the `tools/optimize/` compressors on anything new.

## Local preview

GitHub Pages serves the repo as-is, no build step. To preview locally:

```bash
cd /home/cdc/sim-foundry-website
python3 -m http.server 8000
# open http://localhost:8000
```

## Deployment

The repo is `sim-foundry/sim-foundry.github.io`; everything pushed to `main`
is served as-is at <https://sim-foundry.github.io> (no build step). All asset
paths are relative, so the site also works from any project-page URL prefix.

An `anonymous` branch holds the scrubbed double-blind variant of the site
(authors/affiliations removed, identifying names like `nv_desk` renamed); its
snapshot is deployed separately under an anonymous account.

## Filling in the 3D viewers

There are two viewer kinds wired up in `static/js/viewers.js`:

- `data-viewer-type="mesh"` — single-object glTF viewer (Three.js + GLTFLoader,
  with EXT_meshopt_compression).
- `data-viewer-type="hybrid"` — Gaussian-splat background + textured glTF
  objects, composited in one canvas via
  [@mkkellogg/gaussian-splats-3d](https://github.com/mkkellogg/GaussianSplats3D).
  Driven by a `scene.json` manifest produced from an OmniGibson scene-state
  JSON; see the `nv_desk` build below.

### Hybrid scene (`nv_desk`)

The hybrid viewer reads `assets/viewers/nv_desk/scene.json`, which contains:

- `splat`: PLY URL + the world-frame `position`/`quaternion_xyzw`/`scale` to
  apply to the splat (taken from the `gs_background` USDObject in the
  OmniGibson scene-state).
- `objects[]`: one entry per scene object with its textured GLB URL and
  world-frame pose.
- `camera`: initial OmniGibson viewer camera pose.

To regenerate after the source scene changes:

```bash
/home/cdc/miniforge3/envs/sam3d/bin/python tools/build_nv_desk_scene.py
```

This:

1. Reads `controllable-digital-cousins/assets/scenes/nv_desk/nv_desk_scene_state_latest_with_gs.json`.
2. Runs `tools/usd_to_glb.py` on each object USD it references, writing
   textured GLBs to `assets/viewers/nv_desk/objects/`.
3. Writes `assets/viewers/nv_desk/scene.json`.
4. Symlinks the source PLY into `assets/viewers/nv_desk/nv_desk_bg.ply` for
   local preview (the symlink target is the gitignored full-resolution file).

## Big files (>100 MB) and local-only originals

GitHub blocks individual files >100 MB, so the repo only carries the
**compressed** production assets (gltfpack meshopt GLBs in `glb/` and
`assets/viewers/*/objects/`, `.ksplat` splats in `splats/`, CRF28 videos).
The uncompressed originals are gitignored and live only on the dev machine:

- `assets/viewers/sf_vs_sam3d/*/sam3d.glb` — raw SAM3D comparison meshes (70–240 MB each).
- `assets/viewers/*/​*_bg.ply` / `splat.ply` — full-resolution Gaussian-splat PLYs
  (symlinked from the source scene repo by the build tools).

Keep backups of those originals — they are not recoverable from this repo.

Scene manifests store both a `local_url` (gitignored local file, used on
`localhost`) and a relative `url` into `splats/` (used in production);
`pickSplatUrl()` in `viewers.js` chooses based on `window.location.hostname`.

To add a new big asset: compress it first (`tools/optimize/compress_glbs.sh`,
`tools/optimize/compress_videos.sh`, or `.ply -> .ksplat` via the splat lib)
and commit only the compressed artifact.

## Remaining placeholders

- **Hero buttons**: PDF / arXiv / Video links still point to `#`.
- **BibTeX**: citation block still has placeholder authors/keys.
- **Abstract**: present in the HTML but commented out.
