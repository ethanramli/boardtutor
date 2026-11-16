import { describe, expect, it } from "vitest";
import { childrenOf, isInside, movedPath, parentOf, targetFolder, uniquePath } from "./tree";

describe("board paths", () => {
  it("picks the first free name in a folder, ignoring case", () => {
    expect(uniquePath(["board"], "", "Board")).toBe("Board 2");
    expect(uniquePath([], "Physics", "Board")).toBe("Physics/Board");
    expect(uniquePath(["Physics/Board", "Physics/Board 2"], "Physics", "Board")).toBe("Physics/Board 3");
  });

  it("tells what is inside a folder without matching look-alike names", () => {
    expect(isInside("Physics/Cells/Board", "Physics")).toBe(true);
    expect(isInside("Physics2/Board", "Physics")).toBe(false);
    expect(parentOf("Physics/Cells/Board")).toBe("Physics/Cells");
    expect(parentOf("Board")).toBe("");
  });

  it("moves only paths under a renamed folder", () => {
    expect(movedPath("Physics/Cells/Board", "Physics", "Bio")).toBe("Bio/Cells/Board");
    expect(movedPath("Physics2/Board", "Physics", "Bio")).toBe("Physics2/Board");
  });

  it("puts new items in the selected folder, the selected board's folder, or the top", () => {
    const folders = ["Physics", "Physics/Cells"];
    expect(targetFolder(null, folders)).toBe("");
    expect(targetFolder("Physics/Cells", folders)).toBe("Physics/Cells");
    expect(targetFolder("Physics/Cells/Board", folders)).toBe("Physics/Cells");
    expect(targetFolder("board", folders)).toBe("");
  });

  it("lists one level at a time", () => {
    const tree = childrenOf(["b", "Physics/x", "a"], ["Physics", "Physics/Cells"], "");
    expect(tree).toEqual({ folders: ["Physics"], boards: ["a", "b"] });
    expect(childrenOf(["Physics/x"], ["Physics", "Physics/Cells"], "Physics").folders).toEqual(["Physics/Cells"]);
  });
});
