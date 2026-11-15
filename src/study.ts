export type Point = { x: number; y: number };
export type Region = Point & { width: number; height: number };

export function regionFor(points: Point[], bounds: { width: number; height: number }, padding = 20): Region | null {
  if (!points.length) return null;
  const { minX, minY, maxX, maxY } = points.reduce((edges, point) => ({
    minX: Math.min(edges.minX, point.x), minY: Math.min(edges.minY, point.y),
    maxX: Math.max(edges.maxX, point.x), maxY: Math.max(edges.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  if (maxX - minX < 12 || maxY - minY < 12) return null;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  return { x, y, width: Math.min(bounds.width, maxX + padding) - x, height: Math.min(bounds.height, maxY + padding) - y };
}

export function timestamp(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const part = (value: number) => String(value).padStart(2, "0");
  return seconds < 3600
    ? `${part(Math.floor(seconds / 60))}:${part(seconds % 60)}`
    : `${part(Math.floor(seconds / 3600))}:${part(Math.floor(seconds / 60) % 60)}:${part(seconds % 60)}`;
}

export type Tutor = "claude" | "codex";
export type AskContext = {
  id: string;
  path: string;
  recorded: boolean;
  focused: boolean;
  scene: string;
};

export function tutorPrompt(context: Pick<AskContext, "path" | "recorded" | "focused">, question: string) {
  const contextFiles = context.recorded
    ? "Use transcript.txt AND recording.mp4 from the study folder. The transcript and video share timestamps. If you cannot directly inspect video, use the JPEGs in frames/ (spaced roughly five seconds apart, starting at zero) or extract the exact frame you need from recording.mp4 with ffmpeg. Cite times when useful."
    : context.focused
      ? "Look at circled.png first. Use board.png and board.excalidraw for surrounding context."
      : "Inspect board.png and board.excalidraw to see my working.";
  return `Study folder: ${JSON.stringify(context.path)}. ${contextFiles} Answer as a study tutor. Explain the step I ask about and pause so I can try the next one. If I explicitly request a canvas edit, save a complete valid Excalidraw scene to annotation.excalidraw beside board.excalidraw, retaining existing element IDs and files where possible. Question: ${question.trim()}`;
}

