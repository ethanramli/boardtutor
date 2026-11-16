import { CaptureUpdateAction, convertToExcalidrawElements, exportToCanvas, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { invoke } from "@tauri-apps/api/core";
import type { BoardAPI } from "./board";
import type { DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";

// Answers Claude's board tools. Items are kept short on purpose: every character
// Claude reads or writes costs tokens, so the page fills in Excalidraw's details.
type Item = {
  kind: string; x?: number; y?: number; width?: number; height?: number;
  text?: string; size?: number; points?: number[][]; color?: string;
};

const TUTOR_RED = "#e03131";
const round = (value: number) => Math.round(value);

function bounds(elements: readonly { x: number; y: number; width: number; height: number }[]) {
  const xs = elements.flatMap((e) => [e.x, e.x + e.width]);
  const ys = elements.flatMap((e) => [e.y, e.y + e.height]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// This webview can draw and read canvas pixels but cannot encode images, so the
// raw pixels go to the backend, which makes the PNG.
async function picture(api: BoardAPI) {
  const canvas = await exportToCanvas({
    elements: api.getSceneElements(), files: api.getFiles(), maxWidthOrHeight: 1000, exportPadding: 10,
    appState: { ...api.getAppState(), exportBackground: true },
  });
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  return invoke<string>("encode_png", new Uint8Array(data.buffer),
    { headers: { "x-width": String(canvas.width), "x-height": String(canvas.height) } });
}

export async function lookAtBoard(api: BoardAPI, name: string, withPicture: boolean) {
  const state = api.getAppState();
  const zoom = state.zoom.value;
  const view = `x ${round(-state.scrollX)}..${round(-state.scrollX + state.width / zoom)}, y ${round(-state.scrollY)}..${round(-state.scrollY + state.height / zoom)}`;
  const elements = api.getSceneElements();
  const lines = elements.map((e) => {
    const where = `at ${round(e.x)},${round(e.y)} size ${round(e.width)}x${round(e.height)}`;
    if (e.type === "text") return `${e.id} text ${JSON.stringify(e.text)} ${where}`;
    if (e.type === "freedraw") return `${e.id} pencil ${where}`;
    return `${e.id} ${e.type} ${where}`;
  });
  let text = `Board: ${name}\nVisible area: ${view}\n${lines.length ? lines.join("\n") : "(empty)"}`;
  let image: string | null = null;
  if (withPicture && elements.length) {
    image = await picture(api);
    const b = bounds(elements);
    text += `\nPicture covers about x ${round(b.x0 - 10)}..${round(b.x1 + 10)}, y ${round(b.y0 - 10)}..${round(b.y1 + 10)}.`;
  }
  return { text, image };
}

function build(item: Item) {
  const color = item.color ?? TUTOR_RED;
  const points = item.points ?? [];
  const [x, y] = points[0] ?? [item.x ?? 0, item.y ?? 0];
  const relative = points.map(([px, py]) => [px - x, py - y] as [number, number]);
  switch (item.kind) {
    case "text":
      return convertToExcalidrawElements([{ type: "text", x, y, text: item.text ?? "", fontSize: item.size ?? 20, strokeColor: color }]);
    case "rectangle":
    case "ellipse":
    case "diamond":
      return convertToExcalidrawElements([{ type: item.kind, x, y, width: item.width ?? 100, height: item.height ?? 60, strokeColor: color }]);
    case "arrow":
    case "line":
      if (relative.length < 2) throw new Error(`${item.kind} needs at least two points`);
      return convertToExcalidrawElements([{ type: item.kind, x, y, points: relative, strokeColor: color }]);
    case "pencil":
      if (relative.length < 2) throw new Error("pencil needs at least two points");
      // ponytail: restoreElements fills in the fields a freehand stroke needs; revisit if Excalidraw adds a pencil shortcut.
      return restoreElements([{
        type: "freedraw", id: crypto.randomUUID(), x, y, points: relative, pressures: [],
        width: Math.max(...relative.map(([px]) => px)) - Math.min(...relative.map(([px]) => px)),
        height: Math.max(...relative.map(([, py]) => py)) - Math.min(...relative.map(([, py]) => py)),
        simulatePressure: true, strokeColor: color, strokeWidth: 2,
      } as never], null);
    default:
      throw new Error(`Unknown kind "${item.kind}". Use text, pencil, arrow, line, rectangle, ellipse or diamond.`);
  }
}

// Claude appears as a second person on the board: a named cursor that moves
// while each item is drawn bit by bit. Only the finished item enters undo history.
const CLAUDE = "claude" as never;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let hideCursor: ReturnType<typeof setTimeout> | undefined;

function showCursor(api: BoardAPI, x: number, y: number) {
  clearTimeout(hideCursor);
  const claude = { username: "Claude", color: { background: "#e03131", stroke: "#e03131" }, pointer: { x, y, tool: "pointer" as const } };
  api.updateScene({ collaborators: new Map([[CLAUDE, claude]]), captureUpdate: CaptureUpdateAction.NEVER });
  hideCursor = setTimeout(() => api.updateScene({ collaborators: new Map(), captureUpdate: CaptureUpdateAction.NEVER }), 2500);
}

type Drawn = ExcalidrawElement & { points?: readonly (readonly [number, number])[]; text?: string; originalText?: string };

// The item as it looks a fraction of the way through drawing it, and where the pen is.
function partway(element: Drawn, fraction: number): { element: Drawn; x: number; y: number } {
  if (element.points && element.points.length > 1) {
    const count = Math.max(2, Math.ceil(element.points.length * fraction));
    const points = element.points.slice(0, count);
    const [px, py] = points[points.length - 1];
    return { element: { ...element, points } as Drawn, x: element.x + px, y: element.y + py };
  }
  if (element.type === "text" && element.text) {
    const text = element.text.slice(0, Math.ceil(element.text.length * fraction));
    return { element: { ...element, text, originalText: text } as Drawn, x: element.x + element.width * fraction, y: element.y + element.height / 2 };
  }
  const width = element.width * fraction;
  const height = element.height * fraction;
  return { element: { ...element, width, height } as Drawn, x: element.x + width, y: element.y + height };
}

// A pencil stroke with only two points would animate in two jumps, so add steps along it.
function smooth(element: Drawn): Drawn {
  if (!element.points || element.points.length > 12) return element;
  const points: [number, number][] = [];
  element.points.forEach(([x, y], index) => {
    const next = element.points![index + 1];
    if (!next) return points.push([x, y]);
    for (let step = 0; step < 6; step += 1) points.push([x + (next[0] - x) * step / 6, y + (next[1] - y) * step / 6]);
  });
  return element.type === "freedraw" ? { ...element, points } as Drawn : element;
}

// Stops animating once past `deadline` and just places the item, because macOS
// slows timers in a window that is not in front.
async function animate(api: BoardAPI, finished: Drawn, deadline: number) {
  const shape = smooth(finished);
  const frames = 18;
  for (let frame = 1; frame < frames && performance.now() < deadline && !document.hidden; frame += 1) {
    const { element, x, y } = partway(shape, frame / frames);
    const others = api.getSceneElementsIncludingDeleted().filter((item) => item.id !== shape.id);
    api.updateScene({ elements: [...others, { ...element, version: shape.version + frame }], captureUpdate: CaptureUpdateAction.NEVER });
    showCursor(api, x, y);
    await sleep(22);
  }
  const others = api.getSceneElementsIncludingDeleted().filter((item) => item.id !== shape.id);
  api.updateScene({ elements: [...others, { ...shape, version: shape.version + frames }], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

export async function drawOnBoard(api: BoardAPI, items: Item[]) {
  if (!Array.isArray(items) || !items.length) throw new Error("items must be a non-empty list");
  const added = items.flatMap(build) as Drawn[];
  const deadline = performance.now() + 1500;
  for (const element of added) await animate(api, element, deadline);
  return `Drew ${items.length} item(s). Ids: ${added.map((e) => e.id).join(", ")}`;
}

export async function eraseFromBoard(api: BoardAPI, ids: string[]) {
  if (!Array.isArray(ids) || !ids.length) throw new Error("ids must be a non-empty list");
  const all = api.getSceneElementsIncludingDeleted();
  const found = all.filter((element) => ids.includes(element.id) && !element.isDeleted);
  for (const element of found) {
    showCursor(api, element.x + element.width / 2, element.y + element.height / 2);
    await sleep(120);
  }
  const gone = new Set(found.map((element) => element.id));
  api.updateScene({
    elements: all.map((element) => gone.has(element.id) ? newElementWith(element, { isDeleted: true }) : element),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  const missing = ids.filter((id) => !gone.has(id));
  return `Erased ${found.length} item(s).${missing.length ? ` Not found: ${missing.join(", ")}` : ""}`;
}

// The backend has already read the file into a data URL (see attach_image).
export async function placeImage(api: BoardAPI, args: { dataURL: string; mimeType: string; x?: number; y?: number; width?: number }) {
  const picture = new Image();
  picture.src = args.dataURL;
  await picture.decode();
  const state = api.getAppState();
  const x = args.x ?? -state.scrollX + 40;
  const y = args.y ?? -state.scrollY + 40;
  const width = args.width ?? Math.min(600, picture.naturalWidth);
  const height = width * picture.naturalHeight / picture.naturalWidth;
  const fileId = crypto.randomUUID() as FileId;
  api.addFiles([{ id: fileId, dataURL: args.dataURL as DataURL, mimeType: args.mimeType as never, created: Date.now() }]);
  const [element] = convertToExcalidrawElements([{ type: "image", x, y, width, height, fileId }]);
  showCursor(api, x + width, y + height);
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), element], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return `Placed the image at ${round(x)},${round(y)}, size ${round(width)}x${round(height)}. Id: ${element.id}`;
}
