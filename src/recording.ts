import { invoke } from "@tauri-apps/api/core";
import { paintViewport } from "./board";
import type { Point } from "./study";

export type TranscriptLine = { startMs: number; endMs: number; text: string };
export type Replay = { id: string; videoPath: string; lines: TranscriptLine[] | null };
export type ActiveRecording = { stop(): Promise<Replay> };

export async function recordBoard(
  board: HTMLDivElement,
  background: () => string,
  pointer: () => Point | null,
): Promise<ActiveRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("This webview does not provide microphone and video recording.");
  }
  // Acquire microphone directly from the click or keypress. Capture only our canvas.
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
  const canvas = document.createElement("canvas");
  const width = Math.min(Math.round(board.clientWidth * (window.devicePixelRatio || 1)), 1920);
  canvas.width = Math.max(2, width);
  canvas.height = Math.max(2, Math.round(board.clientHeight / board.clientWidth * width));
  let video: MediaStream | undefined;
  let animation = 0;
  let id: string | undefined;
  const cleanup = () => {
    cancelAnimationFrame(animation);
    microphone.getTracks().forEach((track) => track.stop());
    video?.getTracks().forEach((track) => track.stop());
  };
  try {
    if (typeof canvas.captureStream !== "function") throw new Error("Canvas recording is unavailable in this webview.");
    const draw = () => {
      paintViewport(board, canvas, background(), pointer());
      animation = requestAnimationFrame(draw);
    };
    draw();
    video = canvas.captureStream(24);
    const stream = new MediaStream([...video.getVideoTracks(), ...microphone.getAudioTracks()]);
    const mimeType = ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), videoBitsPerSecond: 2_500_000 });
    const format = recorder.mimeType.includes("mp4") ? "mp4" : "webm";
    id = await invoke<string>("start_recording", { format });
    const recordingId = id;
    let writes = Promise.resolve();
    let failure: unknown;
    let index = 0;
    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
    recorder.addEventListener("error", () => { failure = new Error("The media recorder stopped unexpectedly."); });
    recorder.addEventListener("dataavailable", ({ data }) => {
      if (!data.size) return;
      index += 1;
      writes = writes.then(async () => {
        await invoke<void>("append_recording", await data.arrayBuffer(), { headers: { "x-recording-id": recordingId } });
      }).catch((error: unknown) => { failure ??= error; });
    });
    recorder.start(1000);
    return {
      async stop() {
        try {
          if (recorder.state !== "inactive") recorder.stop();
          await stopped;
          await writes;
          if (failure) throw failure;
          if (!index) throw new Error("No frames were recorded. Try recording for a few seconds.");
        } catch (error) {
          await invoke("cancel_recording", { id: recordingId }).catch(() => {});
          throw error;
        } finally {
          cleanup();
        }
        return invoke<Replay>("finish_recording", { id: recordingId });
      },
    };
  } catch (error) {
    cleanup();
    if (id) await invoke("cancel_recording", { id }).catch(() => {});
    throw error;
  }
}
