"""Normalize a raw device model into an xds library model (run inside Blender).

    blender -b --factory-startup -P scripts/build_library_models.py -- iphone-17-pro SRC.glb OUT.glb
    blender -b --factory-startup -P scripts/build_library_models.py -- macbook-pro-14 SRC.glb OUT.glb

What it does, per the model conventions in docs/agent-guide.md §3.1:

- the display becomes its own mesh named `Screen`, facing out, with UVs 0–1 the right way up as
  seen from the front (u → right, v → up), so a rendered screen PNG maps on unmirrored;
- the front faces +Z (Blender −Y), the origin sits at the bottom center, transforms are applied;
- moving parts are named and pivoted on their joint (the MacBook's `Lid` on its hinge, with
  `xds.limits`);
- the iPhone's cover glass, which sits in front of the panel and greys the screen out, is removed;
- textures are re-encoded as WebP and meshes Draco-compressed, which the studio decodes.

The sources were the Sketchfab-style GLBs "iPhone 17 Pro.glb" and "macbook_pro_14_inch_M5.glb";
they are not kept in the repo. The outputs in xds/library/models/ are what projects load.
"""

import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

MODEL, SRC, OUT = sys.argv[sys.argv.index("--") + 1:][:3]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def flatten():
    """Unparent every mesh (keeping its world transform) and drop the empties."""
    for o in meshes():
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in [o for o in bpy.context.scene.objects if o.type == "EMPTY"]:
        bpy.data.objects.remove(o)


def apply_transforms(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    return o


def separate_material(obj, material, name):
    """Split the faces using `material` out of `obj` into a new object called `name`."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    idx = [i for i, s in enumerate(obj.material_slots) if s.material and s.material.name == material]
    new_me = obj.data.copy()
    bm2 = bmesh.new()
    bm2.from_mesh(new_me)
    bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if f.material_index not in idx], context="FACES")
    bm2.to_mesh(new_me)
    bm2.free()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    new = bpy.data.objects.new(name, new_me)
    new_me.name = name
    new.matrix_world = obj.matrix_world.copy()
    bpy.context.scene.collection.objects.link(new)
    return new


def bounds(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def transform_all(m):
    for o in meshes():
        if o.parent is None:
            o.matrix_world = m @ o.matrix_world


def ground_and_center():
    lo, hi = bounds(meshes())
    transform_all(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))


def fix_screen(screen, front):
    """Make the screen face `front`, drop faces facing away, and orient its UVs u→right, v→up."""
    me = screen.data
    bm = bmesh.new()
    bm.from_mesh(me)
    rot = screen.matrix_world.to_3x3()
    facing = sum((rot @ f.normal).dot(front) * f.calc_area() for f in bm.faces)
    if facing < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.normal_update()
    back = [f for f in bm.faces if (rot @ f.normal).dot(front) <= 0]
    if back:
        bmesh.ops.delete(bm, geom=back, context="FACES")
    bm.to_mesh(me)
    bm.free()

    # Seen from the front (`front` points at the viewer, Blender Z is up), the viewer's right is
    # up × front, and the screen's own up is front × right.
    up = Vector((0, 0, 1))
    right = up.cross(front).normalized()
    true_up = front.cross(right).normalized()
    uv = me.uv_layers.active.data
    pts = [(screen.matrix_world @ me.vertices[l.vertex_index].co, uv[l.index].uv.copy()) for l in me.loops]
    def corr(axis, k):
        mx = sum(p.dot(axis) for p, _ in pts) / len(pts)
        mu = sum(u[k] for _, u in pts) / len(pts)
        return sum((p.dot(axis) - mx) * (u[k] - mu) for p, u in pts)
    flip_u, flip_v = corr(right, 0) < 0, corr(true_up, 1) < 0
    for l in uv:
        if flip_u:
            l.uv.x = 1 - l.uv.x
        if flip_v:
            l.uv.y = 1 - l.uv.y
    print(f"screen: reversed={facing < 0} dropped_back_faces={len(back)} flip_u={flip_u} flip_v={flip_v}")


def keep_one_screen_material(screen):
    """The studio swaps the screen's material for the rendered PNG; keep a single slot."""
    mats = [s.material for s in screen.material_slots if s.material]
    screen.data.materials.clear()
    if mats:
        screen.data.materials.append(mats[0])


if MODEL == "iphone-17-pro":
    body = bpy.data.objects["iPhone 17 Pro"]
    display = bpy.data.objects["iPhone 17 Pro.001"]
    screen = separate_material(display, "OLED", "Screen")
    # The cover glass sits over the panel and greys out the unlit screen image; drop it.
    bpy.data.objects.remove(separate_material(display, "Glass", "Cover glass"))
    body.name, display.name = "Body", "Display"
    keep_one_screen_material(screen)
    # The display faced Blender +Y (glTF −Z); turn it to the front (Blender −Y = glTF +Z).
    transform_all(Matrix.Rotation(math.pi, 4, "Z"))
    ground_and_center()
    apply_transforms(meshes())
    fix_screen(screen, Vector((0, -1, 0)))

elif MODEL == "macbook-pro-14":
    # The source's lid group (its node names are random); everything else is the base.
    lid_root = bpy.data.objects["RcexTyyhpuJYATQ"]
    lid_names = {o.name for o in lid_root.children_recursive if o.type == "MESH"}
    flatten()
    screen = bpy.data.objects["tfTbkkzhxqpKRgC"]
    screen.name = screen.data.name = "Screen"
    keep_one_screen_material(screen)
    lid_parts = [bpy.data.objects[n] for n in lid_names if n != "tfTbkkzhxqpKRgC"]
    base_parts = [o for o in meshes() if o.name not in lid_names and o is not screen]
    ground_and_center()
    apply_transforms(meshes())
    lid = join(lid_parts, "Lid")
    base = join(base_parts, "Base")
    # Hinge: the lid's lowest edge, across its full width.
    lo, _ = bounds([lid])
    low = [lid.matrix_world @ v.co for v in lid.data.vertices if (lid.matrix_world @ v.co).z < lo.z + 0.002]
    hinge = Vector((0, sum(p.y for p in low) / len(low), sum(p.z for p in low) / len(low)))
    bpy.context.scene.cursor.location = hinge
    bpy.ops.object.select_all(action="DESELECT")
    lid.select_set(True)
    bpy.context.view_layer.objects.active = lid
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    screen.parent = lid
    screen.matrix_parent_inverse = lid.matrix_world.inverted()
    # rotateX > 0 closes the lid (glTF: +Y toward +Z); the modeled pose is open about 110°.
    lid["xds.limits"] = {"rotateX": [-25, 110]}
    # The lid leans back; its front is −Y tilted up by the lean.
    s_lo, s_hi = bounds([screen])
    lean = math.atan2(s_hi.y - s_lo.y, s_hi.z - s_lo.z)
    fix_screen(screen, Vector((0, -math.cos(lean), math.sin(lean))))
    print(f"hinge at y={hinge.y:.4f} z={hinge.z:.4f}, lid lean {math.degrees(lean):.1f}°")

else:
    raise SystemExit(f"unknown model {MODEL}")

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_yup=True, export_apply=True,
    export_texcoords=True, export_normals=True, export_materials="EXPORT", export_extras=True,
    export_image_format="WEBP", export_image_quality=90,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    use_selection=False,
)
print("wrote", OUT)
