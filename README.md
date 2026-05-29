# Sim Foundry — Research Website

Static research project page for the [sim-foundry](https://github.com/sim-foundry) GitHub organization. Layout is modeled on [PointWorld](https://point-world.github.io) with 3D viewer placeholders modeled on [PolaRiS](https://polaris-evals.github.io).

## File layout

```
index.html              # main page
static/css/index.css    # all styles
static/js/viewers.js    # 3D viewer wiring (currently stubbed)
static/images/          # favicon and any static images
static/videos/<scene>/  # qualitative result videos grouped by scene
assets/videos/          # walkthrough videos
assets/viewers/         # splat / mesh assets for the 3D viewers
```

## Local preview

GitHub Pages serves the repo as-is, no build step. To preview locally:

```bash
cd /home/cdc/sim-foundry-website
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages under `sim-foundry`

You have two options under the `sim-foundry` org:

### Option A — Org landing site at `sim-foundry.github.io`

Create a repo named **exactly** `sim-foundry.github.io` under the org. Anything on its default branch is served at `https://sim-foundry.github.io`.

```bash
cd /home/cdc/sim-foundry-website
git init
git add .
git commit -m "Initial research page"
git branch -M main
git remote add origin git@github.com:sim-foundry/sim-foundry.github.io.git
git push -u origin main
```

Then in **Settings → Pages**: source = `main` branch, `/ (root)`.

### Option B — Project page at `sim-foundry.github.io/<repo-name>`

Create a repo with any name (e.g. `research-page`) under the org and push to it the same way. In **Settings → Pages**, pick the `main` branch and `/ (root)`. Site will be served at `https://sim-foundry.github.io/<repo-name>/`.

> If you go with Option B, edit the `static/css/index.css` and `index.html` asset paths only if you use absolute paths — current paths are all relative, so it'll work either way.

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

## Big-file hosting (>100 MB)

GitHub blocks individual files >100 MB. Files that cross that threshold are
hosted as Release assets on
[`simfoundry/sim-foundry-website-assets`](https://github.com/simfoundry/sim-foundry-website-assets)
and kept out of the repo via `.gitignore`. Today this covers:

- `assets/viewers/sf_vs_sam3d/*/sam3d.glb` — SAM3D comparison meshes.
- `assets/viewers/nv_desk/nv_desk_bg.ply` — 3D Gaussian Splat background.

The manifest stores both a `local_url` (gitignored symlink, used on
`localhost`) and a Release `url` (used in production); `pickSplatUrl()` in
`viewers.js` chooses based on `window.location.hostname`.

To publish a new big asset:

1. Draft a Release on `sim-foundry-website-assets` with a tag like
   `v0.1-nv-desk` and attach the file.
2. Update the `--ply-url` (or equivalent) when rebuilding the manifest, or
   edit the manifest's `splat.url` directly.

## Sections you'll want to fill in next

- **Hero**: project title, subtitle, author list, affiliations, venue, and the PDF / arXiv / video / code button links.
- **Teaser**: replace the placeholder div with a `<video>` or `<img>`.
- **Abstract**: replace the placeholder paragraph.
- **Walkthrough video**: replace the placeholder with a YouTube `<iframe>`.
- **Qualitative results**: replace each `.result-placeholder` with a `<video>` or `<img>`.
- **BibTeX**: update the citation block.
