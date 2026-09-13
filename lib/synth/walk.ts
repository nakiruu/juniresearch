/** Every string leaf of a JSON-like value, with its dotted/indexed path. */
export function stringLeaves(obj: unknown, path = ""): { path: string; text: string }[] {
  if (typeof obj === "string") return [{ path, text: obj }];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
  if (obj && typeof obj === "object")
    return Object.entries(obj).flatMap(([k, v]) => stringLeaves(v, path ? `${path}.${k}` : k));
  return [];
}
