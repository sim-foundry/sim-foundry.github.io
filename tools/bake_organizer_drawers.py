"""Re-export the nv_desk wooden organizer GLB with its drawers baked open.

The per-object asset USD is articulated (3 prismatic drawer joints, axis +X in
the object-local frame). `usd_to_glb.convert` bakes the *rest* state (drawers
closed), but the reconstructed OmniGibson scene leaves the drawers partly open
at `joint_pos = [drawer_1, drawer_2, drawer_3]`. To match the scene (and the
SAM3D-comparison simfoundry output), we translate each drawer link's visual
mesh by `+X * joint_pos` before flattening.

Run inside the USD env:
    /home/cdc/miniforge3/envs/sam3d/bin/python tools/bake_organizer_drawers.py
"""
from pathlib import Path
import numpy as np
import trimesh
from PIL import Image
from pxr import Usd

from usd_to_glb import _iter_visual_meshes, _extract_mesh, _resolve_diffuse_texture

USD = Path("/home/cdc/controllable-digital-cousins/assets/scenes/nv_desk/objects/"
           "wooden_organizer_with_drawer/vmufpr/usd/vmufpr.usd")
OUT = Path("assets/viewers/nv_desk/objects/wooden_organizer_with_drawer_vmufpr.glb")

# Drawer joint positions from the canonical scene the website builds from:
# assets/scenes/nv_desk/nv_desk_scene_state_latest_with_gs.json
# (state.registry.object_registry.wooden_organizer_with_drawer_vmufpr_13.joint_pos).
# Only the top/wide drawer (drawer_1) is open; the lower two stay closed. Axis
# is +X in the object-local frame (localRot0 identity, root identity).
DRAWER_OFFSET_X = {
    "/drawer_1_link/": 0.09957137703895569,
    "/drawer_2_link/": 0.0,
    "/drawer_3_link/": 0.0,
}


def main():
    stage = Usd.Stage.Open(str(USD))
    all_verts, all_faces, all_uvs = [], [], []
    tex_path = None
    vert_offset = 0
    for mesh_prim in _iter_visual_meshes(stage):
        path = str(mesh_prim.GetPath())
        verts, faces, uvs = _extract_mesh(stage, mesh_prim)
        # Slide drawer links out along +X by their joint position.
        for key, dx in DRAWER_OFFSET_X.items():
            if key in path:
                verts = verts.copy()
                verts[:, 0] += dx
                break
        if tex_path is None:
            tex_path = _resolve_diffuse_texture(stage, mesh_prim)
        all_verts.append(verts)
        all_faces.append(faces + vert_offset)
        all_uvs.append(uvs if uvs is not None else np.zeros((len(verts), 2), dtype=np.float32))
        vert_offset += len(verts)

    vertices = np.concatenate(all_verts, axis=0)
    faces = np.concatenate(all_faces, axis=0)
    uvs = np.concatenate(all_uvs, axis=0)

    if not tex_path:
        guess = USD.parent.parent / "material" / "material_0.png"
        if guess.exists():
            tex_path = str(guess)

    m = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    if tex_path:
        img = Image.open(tex_path).convert("RGB")
        material = trimesh.visual.material.PBRMaterial(
            baseColorTexture=img, metallicFactor=0.0, roughnessFactor=1.0,
        )
        m.visual = trimesh.visual.TextureVisuals(uv=uvs, material=material)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    m.export(str(OUT), file_type="glb")
    print(f"wrote {OUT}  verts={len(vertices)} tris={len(faces)} tex={tex_path}")


if __name__ == "__main__":
    main()
