/**
 * The effective type size (data-models §2.2, §2.5d), in the format's px:
 *
 *   node.size → node.scale × (the role's size) → role.size → role.scale × band default → band default
 *
 * A px `size` is absolute; a `scale` is a factor, so a role (or node) that says "1.2 × the
 * headline default" keeps its place in the hierarchy in every format. The renderer, the
 * inspector and the slide thumbnails all resolve through here, so they can't disagree.
 */

export interface SizeSource {
  size?: number | null;
  scale?: number | null;
}

/** The role's own size: its px size, else its scale (default 1) times the band default. */
export function roleSize(role: SizeSource | null | undefined, bandDefault: number): number {
  if (role?.size) return role.size;
  return bandDefault * (role?.scale ?? 1);
}

/** The node's size over its role: its px size, else its scale (default 1) times the role's. */
export function effectiveSize(
  data: SizeSource | null | undefined,
  role: SizeSource | null | undefined,
  bandDefault: number,
): number {
  if (data?.size) return data.size;
  return roleSize(role, bandDefault) * (data?.scale ?? 1);
}
