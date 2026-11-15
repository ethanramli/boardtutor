import { restore, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

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
