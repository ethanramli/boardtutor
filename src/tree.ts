// Boards and folders are paths such as "Physics/Cells/Board 2", relative to the
// whiteboards folder. These helpers are pure so they can be tested on their own.
export type Entry = { path: string; folder: boolean };

export const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const parentOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
export const joinPath = (dir: string, name: string) => dir ? `${dir}/${name}` : name;
export const isInside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

// First free path in `dir` named base, "base 2", "base 3", ... (case-insensitive).
export function uniquePath(taken: string[], dir: string, base: string) {
  const used = new Set(taken.map((path) => path.toLowerCase()));
  for (let number = 1; ; number += 1) {
    const path = joinPath(dir, number === 1 ? base : `${base} ${number}`);
    if (!used.has(path.toLowerCase())) return path;
  }
}

// The path after `from` has been renamed to `to`; paths elsewhere are unchanged.
export function movedPath(path: string, from: string, to: string) {
  return isInside(path, from) ? to + path.slice(from.length) : path;
}

// Where "New board" and "New folder" put things: the selected folder, the
// folder holding the selected board, or the top of whiteboards/ ("").
export function targetFolder(selected: string | null, folders: string[]) {
  if (!selected) return "";
  if (folders.includes(selected)) return selected;
  const parent = parentOf(selected);
  return folders.includes(parent) ? parent : "";
}

export function childrenOf(boards: string[], folders: string[], dir: string) {
  const direct = (path: string) => parentOf(path) === dir;
  return { folders: folders.filter(direct).sort(byName), boards: boards.filter(direct).sort(byName) };
}
