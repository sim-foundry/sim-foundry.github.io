# Optimization baseline — 2026-06-03T20:43Z

## Main repo (ANON.github.io)
Total (excl .git): 874M

### Local GLBs by group
assets/viewers/desk_1/objects                89M
assets/viewers/kitchen_2_demo/objects         53M
assets/viewers/dining_1_demo/objects          46M
assets/viewers/toys_1_demo/objects            39M
assets/viewers/outdoor_1_demo/objects         45M
assets/viewers/interactive_objects            251M
assets/viewers/sf_vs_sam3d                    51M
ALL local GLBs: 125 files, 571M

### Videos
main repo: 22 files, 287M

### Images: 83 files, 17M

## External repo (website-assets)
glb: 5 files, 106M
qual_videos: 81 files, 611M
splats: 49M

---

## Phase 1 results — GLB compression (meshopt + KTX2/ETC1S)

Tool: native gltfpack 0.20, `-cc -tc` (replace in place). Decoder support added to
viewers.js (KTX2Loader + Basis transcoder from pinned three.js CDN).

| Group | Before | After |
|---|---|---|
| Main-repo local GLBs (125 files) | 571 MB | **98 MB** (5.9x) |

Verified end-to-end under headless Chrome (SwiftShader): meshopt geometry decodes,
KTX2 textures transcode and apply (`OK meshes=1 textured=1`), geometry-only
vertex-colored meshes render (`OK meshes=1 textured=0`).

External-repo SAM3D GLBs (106 MB) are already meshopt-compressed and texture-free
(vertex colors) — re-packing yields no meaningful gain; their reduction comes from
video (Phase 2), not geometry.

Net repo effect: 874 MB -> ~401 MB so far (GLB only).

---

## Phase 2 results — video re-encode (libx264 CRF 28, <=720p, no audio, faststart)

| Group | Before | After | Ratio |
|---|---|---|---|
| Main-repo videos (22) | 286.4 MB | **70.1 MB** | 4.1x |
| External qual_videos (81) | 610.1 MB | **70.8 MB** | 8.6x |
| **Combined video** | 896.5 MB | **140.9 MB** | 6.4x |

Sample SSIM (vs original): main-repo clips >=0.985; toughest splat-render qual clip 0.973
at 10.9x — visually fine for looping motion. `_seq` variants preserved (same names).

~~NOTE: external qual_videos live in website-assets and are served to the live
site from raw.githubusercontent @ main. The compressed versions are on branch
`optimize-assets` (NOT pushed) — the live site keeps serving originals until that branch
is reviewed + published.~~

---

## Update — 2026-06-04: single-repo consolidation

The compressed qual_videos were published, all page videos were re-encoded and
moved around, and finally the entire `website-assets` repo content
(`glb/`, `splats/`, `videos/`, `qual_videos/`, ~370 MB compressed) was vendored
back into this repo with relative same-origin paths. Tracked site content is
now ~500 MB — under the 1 GB Pages limit, which is what originally forced the
two-repo split. The external assets repo is no longer referenced and has been
retired; the uncompressed originals (raw `sam3d.glb`, full-res PLYs) exist only
on the dev machine (see README "Big files").
