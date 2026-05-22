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

The viewer containers are blank by design. To wire them up:

1. Drop your assets under `assets/viewers/` (e.g. `scene-01.splat`, `object-01.glb`).
2. In `static/js/viewers.js`, populate the `SCENE_ASSETS` and `OBJECT_ASSETS` maps:
   ```js
   const SCENE_ASSETS = {
     "scene-01": "assets/viewers/scene-01.splat",
     "scene-02": "assets/viewers/scene-02.splat",
   };
   ```
3. Replace the stubbed `setSrc` body with a real loader. There's a commented `loadMesh` example in the file using `three.js` + `GLTFLoader`. For Gaussian splats, drop in [@mkkellogg/gaussian-splats-3d](https://github.com/mkkellogg/GaussianSplats3D) or [antimatter15/splat](https://github.com/antimatter15/splat).

## Sections you'll want to fill in next

- **Hero**: project title, subtitle, author list, affiliations, venue, and the PDF / arXiv / video / code button links.
- **Teaser**: replace the placeholder div with a `<video>` or `<img>`.
- **Abstract**: replace the placeholder paragraph.
- **Walkthrough video**: replace the placeholder with a YouTube `<iframe>`.
- **Qualitative results**: replace each `.result-placeholder` with a `<video>` or `<img>`.
- **BibTeX**: update the citation block.
