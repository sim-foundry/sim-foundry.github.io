"""Convert an OmniGibson per-object USD into a textured GLB.

Targets the per-object USD layout produced by the SAM3D / digital-cousins
pipeline: one Xform per object, a `visuals` Xform containing UsdGeomMeshes
bound to a single UsdPreviewSurface material with a `diffuseColor` texture.

Run inside an env with `pxr`, `trimesh`, `PIL`:
    python tools/usd_to_glb.py <in.usd> <out.glb>
"""
from __future__ import annotations
import argparse
from pathlib import Path
import numpy as np
from PIL import Image
import trimesh
from pxr import Usd, UsdGeom, UsdShade


def _iter_visual_meshes(stage: Usd.Stage):
    """Yield UsdGeom.Mesh prims that are visual (not collision)."""
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        path = str(prim.GetPath()).lower()
        if "collision" in path or "/colliders/" in path:
            continue
        # Drop the duplicate /visuals/<...> scope at stage root: prefer the
        # canonical path nested under the object Xform if both exist.
        if path.startswith("/visuals/"):
            continue
        yield prim


def _resolve_diffuse_texture(stage: Usd.Stage, mesh_prim) -> str | None:
    mat, _ = UsdShade.MaterialBindingAPI(mesh_prim).ComputeBoundMaterial()
    if not mat:
        return None
    surf = mat.GetSurfaceOutput()
    if not surf or not surf.GetConnectedSource():
        return None
    shader = UsdShade.Shader(surf.GetConnectedSource()[0].GetPrim())
    diffuse = shader.GetInput("diffuseColor")
    if not diffuse:
        return None
    src = diffuse.GetConnectedSource()
    if not src:
        return None
    tex_shader = UsdShade.Shader(src[0].GetPrim())
    file_in = tex_shader.GetInput("file")
    if not file_in:
        return None
    asset = file_in.Get()
    if not asset:
        return None
    return asset.resolvedPath or None


def _extract_mesh(stage: Usd.Stage, mesh_prim) -> tuple[np.ndarray, np.ndarray, np.ndarray | None]:
    """Return (vertices Nx3, faces Mx3, uvs Mx3x2 or None) all per-corner-unrolled."""
    mesh = UsdGeom.Mesh(mesh_prim)
    points = np.asarray(mesh.GetPointsAttr().Get(), dtype=np.float32)
    indices = np.asarray(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int32)
    counts = np.asarray(mesh.GetFaceVertexCountsAttr().Get(), dtype=np.int32)

    if not np.all(counts == 3):
        # Triangulate fan-style (works for convex polys); SAM3D output is
        # already triangulated so this branch is mostly defensive.
        tri_indices = []
        cur = 0
        for c in counts:
            for i in range(1, c - 1):
                tri_indices.extend([indices[cur], indices[cur + i], indices[cur + i + 1]])
            cur += c
        indices = np.asarray(tri_indices, dtype=np.int32)

    # Apply local prim transform (USDs from this pipeline are usually identity
    # at the mesh level, but be safe).
    xform_cache = UsdGeom.XformCache()
    local_xform = xform_cache.GetLocalToWorldTransform(mesh_prim)
    local_xform = np.asarray(local_xform, dtype=np.float32).T  # row-major → col-major
    if not np.allclose(local_xform, np.eye(4), atol=1e-6):
        points_h = np.concatenate([points, np.ones((len(points), 1), dtype=np.float32)], axis=1)
        points = (local_xform @ points_h.T).T[:, :3]

    pv_api = UsdGeom.PrimvarsAPI(mesh_prim)
    st_pv = pv_api.GetPrimvar("st") or pv_api.GetPrimvar("primvars:st")
    raw_uvs = np.asarray(st_pv.Get(), dtype=np.float32) if st_pv else None

    # Unroll to per-corner so glTF can store one UV per vertex; this also makes
    # us robust to faceVarying interpolation (the common case here).
    corner_pts = points[indices]
    if raw_uvs is not None:
        if len(raw_uvs) == len(indices):
            corner_uvs = raw_uvs.copy()
        elif len(raw_uvs) == len(points):
            corner_uvs = raw_uvs[indices]
        else:
            corner_uvs = None
        # NOTE: we *don't* V-flip here. USD's `st` is OpenGL-style (V=0 at
        # bottom) and glTF expects V=0 at top, but `trimesh.Trimesh.export`
        # already does that flip for us on GLB write. Double-flipping leaves
        # the GLB UVs identical to USD UVs and the texture renders inverted.
    else:
        corner_uvs = None

    new_faces = np.arange(len(corner_pts), dtype=np.int32).reshape(-1, 3)
    return corner_pts, new_faces, corner_uvs


def convert(usd_path: Path, glb_path: Path) -> dict:
    stage = Usd.Stage.Open(str(usd_path))
    if stage is None:
        raise RuntimeError(f"Failed to open USD: {usd_path}")

    all_verts, all_faces, all_uvs = [], [], []
    tex_path = None
    vert_offset = 0
    for mesh_prim in _iter_visual_meshes(stage):
        verts, faces, uvs = _extract_mesh(stage, mesh_prim)
        if tex_path is None:
            tex_path = _resolve_diffuse_texture(stage, mesh_prim)
        all_verts.append(verts)
        all_faces.append(faces + vert_offset)
        if uvs is not None:
            all_uvs.append(uvs)
        else:
            all_uvs.append(np.zeros((len(verts), 2), dtype=np.float32))
        vert_offset += len(verts)

    if not all_verts:
        raise RuntimeError(f"No visual meshes found in {usd_path}")

    vertices = np.concatenate(all_verts, axis=0)
    faces = np.concatenate(all_faces, axis=0)
    uvs = np.concatenate(all_uvs, axis=0)

    # Fall back to the sibling material/material_0.png when the USD's resolved
    # texture path is empty (some captures store relative refs that don't
    # resolve outside of the original render env).
    if not tex_path:
        guess = usd_path.parent.parent / "material" / "material_0.png"
        if guess.exists():
            tex_path = str(guess)

    m = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    if tex_path:
        img = Image.open(tex_path).convert("RGB")
        material = trimesh.visual.material.PBRMaterial(
            baseColorTexture=img,
            metallicFactor=0.0,
            roughnessFactor=1.0,
        )
        m.visual = trimesh.visual.TextureVisuals(uv=uvs, material=material)

    glb_path.parent.mkdir(parents=True, exist_ok=True)
    m.export(str(glb_path), file_type="glb")
    return {
        "usd": str(usd_path),
        "glb": str(glb_path),
        "vertices": int(len(vertices)),
        "triangles": int(len(faces)),
        "texture": tex_path,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("usd", type=Path)
    ap.add_argument("glb", type=Path)
    args = ap.parse_args()
    info = convert(args.usd, args.glb)
    print(info)
