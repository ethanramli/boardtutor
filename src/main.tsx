import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { CaptureUpdateAction, Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readScene, serializeBoard, snapshot, type BoardAPI, type BoardData } from "./board";
import { recordBoard, type ActiveRecording, type Replay } from "./recording";
import { TerminalPane } from "./Terminal";
import { regionFor, timestamp, type AskContext, type Tutor, type Point, type Region } from "./study";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";

declare global {
  interface Window { EXCALIDRAW_ASSET_PATH: string }
}
window.EXCALIDRAW_ASSET_PATH = new URL("./", window.location.href).href;

const encode = (text: string) => new TextEncoder().encode(text);
const shortcut = /Mac/i.test(navigator.platform) ? "⌘⇧" : "Ctrl+Shift+";

function App() {
  const [initial, setInitial] = useState<{ data: BoardData | undefined } | null>(null);
  const [error, setError] = useState("");
  const [saveLabel, setSaveLabel] = useState("");
  const [tutor, setTutor] = useState<Tutor>("codex");
  const [context, setContext] = useState<AskContext | null>(null);
  const [marking, setMarking] = useState(false);
  const [stroke, setStroke] = useState<Point[]>([]);
  const [recording, setRecording] = useState<"idle" | "starting" | "recording" | "finishing" | "transcribing">("idle");
  const [replay, setReplay] = useState<Replay | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const api = useRef<BoardAPI | null>(null);
  const pointer = useRef<Point | null>(null);
  const mark = useRef<Point[]>([]);
  const marked = useRef<Region | null>(null);
  const active = useRef<ActiveRecording | null>(null);
  const recordBusy = useRef(false);
  const askBusy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const savedSignature = useRef("");
  const savedImages = useRef(new Map<string, string>());

  useEffect(() => {
    void invoke<string | null>("load_board").then((text) => {
      const data = text ? readScene(text) : undefined;
      setInitial({ data });
    }).catch((cause: unknown) => setError(`Could not load the local board. ${String(cause)}`));
    void invoke<Replay | null>("latest_recording").then(setReplay).catch((cause: unknown) => setError(String(cause)));
  }, []);

  function flushBoard() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const current = api.current;
    if (!current) return saves.current;
    const files = current.getFiles();
    const fileIds = new Set(current.getSceneElements().flatMap((element) =>
      element.type === "image" && element.fileId && files[element.fileId] ? [element.fileId] : []));
    const bytes = encode(serializeBoard(current, false));
    const pending = saves.current.catch(() => {}).then(async () => {
      for (const id of fileIds) {
        const file = files[id];
        if (savedImages.current.get(id) === file.dataURL) continue;
        await invoke<void>("save_board_image", encode(JSON.stringify(file)), { headers: { "x-image-id": encodeURIComponent(id) } });
        savedImages.current.set(id, file.dataURL);
      }
      await invoke<void>("save_board", bytes);
    });
    saves.current = pending;
    return pending;
  }

  function changed() {
    const current = api.current;
    if (!current || !initial) return;
    const appState = current.getAppState();
    const signature = JSON.stringify([
      getSceneVersion(current.getSceneElementsIncludingDeleted()),
      Object.keys(current.getFiles()).sort(), appState.viewBackgroundColor, appState.gridSize,
    ]);
    if (signature === savedSignature.current) return;
    savedSignature.current = signature;
    if (timer.current !== null) clearTimeout(timer.current);
    setSaveLabel("Saving…");
    timer.current = setTimeout(() => {
      void flushBoard().then(() => setSaveLabel("Saved locally")).catch((cause: unknown) => {
        savedSignature.current = "";
        setSaveLabel("Save failed");
        setError(String(cause));
      });
    }, 350);
  }

  useEffect(() => {
    let allowClose = false;
    const subscribe = getCurrentWindow().onCloseRequested(async (event) => {
      if (allowClose) return;
      event.preventDefault();
      if (recordBusy.current || active.current) {
        setError("Stop the recording and let it finish before closing.");
        return;
      }
      try {
        await flushBoard();
        allowClose = true;
        await getCurrentWindow().destroy();
      } catch (cause) {
        setError(`Could not save before closing. ${String(cause)}`);
        allowClose = false;
      }
    });
    void subscribe.catch((cause: unknown) => setError(String(cause)));
    return () => { void subscribe.then((unlisten) => unlisten()).catch(() => {}); };
  }, []);

  async function importBoard() {
    if (!api.current) return;
    const path = await open({ multiple: false, filters: [{ name: "Excalidraw board", extensions: ["excalidraw"] }] });
    if (!path) return;
    const scene = readScene(await invoke<string>("read_board_file", { path }));
    api.current.addFiles(Object.values(scene.files));
    api.current.updateScene({ elements: scene.elements, appState: scene.appState, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    api.current.scrollToContent(scene.elements, { fitToViewport: true });
    marked.current = null;
  }

  async function exportBoard() {
    if (!api.current) return;
    const chosen = await save({ defaultPath: "board.excalidraw", filters: [{ name: "Excalidraw board", extensions: ["excalidraw"] }] });
    if (!chosen) return;
    const path = chosen.endsWith(".excalidraw") ? chosen : `${chosen}.excalidraw`;
    await invoke("write_board_file", encode(serializeBoard(api.current)), { headers: { "x-board-path": encodeURIComponent(path) } });
  }

  async function transcribe(item: Replay) {
    setRecording("transcribing");
    setReplay(await invoke<Replay>("transcribe", { id: item.id }));
  }

  async function toggleRecording() {
    if (recordBusy.current || !board.current || !api.current) return;
    recordBusy.current = true;
    setError("");
    try {
      if (active.current) {
        const session = active.current;
        active.current = null;
        setRecording("finishing");
        const item = await session.stop();
        setReplay(item);
        setShowReview(true);
        await transcribe(item);
        setRecording("idle");
      } else {
        setRecording("starting");
        setMarking(false);
        setStroke([]);
        // Dependency setup can be checked without losing the microphone gesture.
        const dependencies = invoke<void>("check_tools").then(() => null, (cause: unknown) => cause);
        const item = await recordBoard(board.current, () => api.current?.getAppState().viewBackgroundColor ?? "#fff", () => pointer.current);
        active.current = item;
        setRecording("recording");
        const issue = await dependencies;
        if (issue) setError(`Transcription setup is incomplete. The app will keep the recorded source if processing fails. ${String(issue)}`);
      }
    } catch (cause) {
      setRecording("idle");
      setError(String(cause));
    } finally {
      recordBusy.current = false;
    }
  }

  async function retryTranscript() {
    if (!replay || recordBusy.current) return;
    recordBusy.current = true;
    setError("");
    try { await transcribe(replay); }
    catch (cause) { setError(String(cause)); }
    finally { setRecording("idle"); recordBusy.current = false; }
  }

  async function ask(mode: "board" | "recording") {
    if (!board.current || !api.current || askBusy.current || recordBusy.current || active.current) return;
    if (mode === "recording" && (!replay || replay.lines === null)) {
      setShowReview(true);
      setError("Finish transcription before opening the video and transcript in Ask.");
      return;
    }
    askBusy.current = true;
    setPreparing(true);
    setError("");
    try {
      const scene = serializeBoard(api.current);
      const region = mode === "board" ? marked.current : null;
      const images = snapshot(board.current, api.current.getAppState().viewBackgroundColor, region);
      const attached = await invoke<{ id: string; path: string }>("prepare_ask", encode(JSON.stringify({
        scene, ...images, recording: mode === "recording" ? replay?.id : undefined,
      })));
      setContext({ ...attached, scene, recorded: mode === "recording", focused: !!images.focus });
      setMarking(false);
      setStroke([]);
      marked.current = null;
    } finally {
      askBusy.current = false;
      setPreparing(false);
    }
  }

  async function applyTutorEdit() {
    if (!context || !api.current) return;
    if (serializeBoard(api.current) !== context.scene) {
      throw new Error("The board changed after Ask. Open a fresh Ask before applying a tutor edit.");
    }
    const raw = await invoke<string | null>("board_annotation", { id: context.id });
    if (!raw) throw new Error("The tutor hasn't saved annotation.excalidraw yet.");
    const scene = readScene(raw);
    if (serializeBoard(api.current) !== context.scene) throw new Error("The board changed while loading the edit.");
    api.current.addFiles(Object.values(scene.files));
    api.current.updateScene({ elements: scene.elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  function run(action: () => Promise<unknown>) {
    setError("");
    void action().catch((cause: unknown) => setError(String(cause)));
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code === "Escape" && marking) {
        setMarking(false);
        setStroke([]);
        marked.current = null;
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.repeat) return;
      const action = event.code === "KeyR" ? toggleRecording
        : event.code === "KeyA" ? () => ask(replay && !marked.current ? "recording" : "board")
        : null;
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        run(action);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  function position(event: PointerEvent<Element>) {
    const rect = board.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startMark(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    marked.current = null;
    mark.current = [position(event)];
    setStroke(mark.current);
  }

  function moveMark(event: PointerEvent<SVGSVGElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    mark.current = [...mark.current, position(event)];
    setStroke(mark.current);
  }

  function finishMark(event: PointerEvent<SVGSVGElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !board.current) return;
    marked.current = regionFor([...mark.current, position(event)], board.current.getBoundingClientRect());
    if (marked.current) setMarking(false);
    else setStroke([]);
  }

  const busy = recording !== "idle" && recording !== "recording";
  return <main className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-icon" aria-hidden="true">∿</span>Excali Tutor</div>
      <div className="file-actions">
        <button onClick={() => run(importBoard)} disabled={!initial}>Open</button>
        <button onClick={() => run(exportBoard)} disabled={!initial}>Export</button>
        <span className="save-label">{saveLabel}</span>
      </div>
      <div className="study-actions">
        <button className={recording === "recording" ? "record active" : "record"}
          onClick={() => run(toggleRecording)} disabled={busy || !initial}
          title={`Record board and microphone (${shortcut}R)`}>
          <span aria-hidden="true">●</span> {recording === "recording" ? "Stop" : busy ? "Processing…" : "Record"}
        </button>
        <button onClick={() => setShowReview(!showReview)} disabled={!replay} aria-pressed={showReview}>Replay</button>
        <button onClick={() => {
          marked.current = null; mark.current = []; setStroke([]); setMarking(!marking);
        }} aria-pressed={marking} disabled={!initial || recording !== "idle"}>Circle</button>
        <select aria-label="Tutor CLI" value={tutor} onChange={(event) => setTutor(event.target.value as Tutor)}>
          <option value="codex">Codex</option><option value="claude">Claude Code</option>
        </select>
        <button className="primary" disabled={!initial || preparing || recording !== "idle"}
          title={`Open tutor with the circled area or latest recording (${shortcut}A)`}
          onClick={() => run(() => ask(replay && !marked.current ? "recording" : "board"))}>
          {preparing ? "Loading…" : "Ask"}
        </button>
      </div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <div className="workspace">
      <section className="board" ref={board}
        onPointerMove={(event) => { pointer.current = position(event); }}
        onPointerLeave={() => { pointer.current = null; }}>
        {initial ? <Excalidraw excalidrawAPI={(value) => { api.current = value; }} initialData={initial.data}
          onChange={changed} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }} />
          : <p className="board-loading">Opening local whiteboard…</p>}
        {(marking || stroke.length > 0) && <svg className={marking ? "mark-layer drawing" : "mark-layer"}
          onPointerDown={startMark} onPointerMove={moveMark} onPointerUp={finishMark}
          onPointerCancel={() => { mark.current = []; setStroke([]); }}>
          <polyline points={stroke.map(({ x, y }) => `${x},${y}`).join(" ")}
            fill="none" stroke="#7555e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>}
        {marking && <div className="board-hint">Circle the part you’re stuck on.</div>}
        {!marking && stroke.length > 0 && <div className="board-hint">Circled area ready for Ask.</div>}
      </section>
      {context && <TerminalPane key={`${context.id}-${tutor}`} context={context} tutor={tutor}
        onApply={() => run(applyTutorEdit)} onClose={() => setContext(null)} />}
      {showReview && replay && <aside className="review-pane" aria-label="Replay">
        <div className="pane-title"><strong>Replay</strong><button aria-label="Close replay" onClick={() => setShowReview(false)}>×</button></div>
        <video key={replay.id} ref={player} controls preload="metadata" src={convertFileSrc(replay.videoPath)} />
        <div className="review-actions">
          <button onClick={() => run(() => ask("recording"))} disabled={replay.lines === null || preparing || recording !== "idle"}>Ask about recording</button>
          <button onClick={() => run(() => ask("board"))} disabled={preparing || recording !== "idle"}>Ask about board</button>
          {replay.lines === null && <button onClick={() => run(retryTranscript)} disabled={recording !== "idle"}>Transcribe locally</button>}
        </div>
        <div className="transcript">
          {replay.lines?.map((line, index) => <button className="transcript-line" key={`${line.startMs}-${index}`}
            onClick={() => { if (player.current) player.current.currentTime = line.startMs / 1000; }}>
            <time>{timestamp(line.startMs)}</time><span>{line.text}</span>
          </button>)}
          {recording === "transcribing" && <p>Transcribing on this computer…</p>}
          {replay.lines?.length === 0 && <p>No speech detected.</p>}
        </div>
      </aside>}
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
