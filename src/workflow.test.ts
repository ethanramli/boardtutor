import { describe, expect, it } from "vitest";
import { regionFor, timestamp, tutorPrompt } from "./study";

describe("study inputs", () => {
  it("clips the circle capture to the visible board", () => {
    expect(regionFor([{ x: 4, y: 5 }, { x: 91, y: 84 }], { width: 100, height: 90 }))
      .toEqual({ x: 0, y: 0, width: 100, height: 90 });
    expect(regionFor([{ x: 4, y: 5 }], { width: 100, height: 90 })).toBeNull();
  });

  it("shows readable video times beyond an hour", () => {
    expect(timestamp(19_500)).toBe("00:19");
    expect(timestamp(3_672_000)).toBe("01:01:12");
  });

  it("includes both recording files in a drafted question", () => {
    const text = tutorPrompt({ path: "/study path", recorded: true, focused: false }, " Why both masses? ");
    expect(text).toContain('"/study path"');
    expect(text).toContain("transcript.txt AND recording.mp4");
    expect(text).toContain("Question: Why both masses?");
  });
});
