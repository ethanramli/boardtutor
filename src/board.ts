import { restore, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { Point, Region } from "./study";

export type BoardData = ExcalidrawInitialDataState;
export type BoardAPI = ExcalidrawImperativeAPI;

export function readScene(text: string) {
  const value = JSON.parse(text);
  if (value?.type !== "excalidraw" || !Array.isArray(value.elements)) {
    throw new Error("This file is not an Excalidraw scene.");
  }
  return restore(value, null, null, { repairBindings: true, refreshDimensions: true });
}

export function serializeBoard(api: BoardAPI, embedImages = true): string {
  return serializeAsJSON(api.getSceneElements(), api.getAppState(), embedImages ? api.getFiles() : {}, "local");
}

export function paintViewport(board: HTMLDivElement, canvas: HTMLCanvasElement, background: string, pointer?: Point | null) {
  const bounds = board.getBoundingClientRect();
  const ctx = canvas.getContext("2d");
  if (!ctx || !bounds.width || !bounds.height) return;
  const sx = canvas.width / bounds.width;
  const sy = canvas.height / bounds.height;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const layer of board.querySelectorAll<HTMLCanvasElement>(".excalidraw__canvas")) {
    const rect = layer.getBoundingClientRect();
    if (layer.width && layer.height && rect.width && rect.height) {
      ctx.drawImage(layer, (rect.left - bounds.left) * sx, (rect.top - bounds.top) * sy, rect.width * sx, rect.height * sy);
    }
  }
  if (pointer) {
    ctx.beginPath();
    ctx.arc(pointer.x * sx, pointer.y * sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#6957d7";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "white";
    ctx.stroke();
  }
}

export function snapshot(board: HTMLDivElement, background: string, region?: Region | null) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(board.clientWidth));
  canvas.height = Math.max(1, Math.round(board.clientHeight));
  paintViewport(board, canvas, background);
  const image = canvas.toDataURL("image/png");
  if (!region || region.width <= 0 || region.height <= 0) return { image };
  const crop = document.createElement("canvas");
  crop.width = Math.ceil(region.width);
  crop.height = Math.ceil(region.height);
  crop.getContext("2d")!.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, crop.width, crop.height);
  return { image, focus: crop.toDataURL("image/png") };
}
