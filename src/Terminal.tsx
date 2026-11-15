import { useEffect, useRef, useState, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export function TerminalPane({ onClose }: { onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(() => Math.min(window.innerWidth * 0.4, 560));

  useEffect(() => {
    const element = host.current!;
    const term = new XTerm({
      fontSize: 13, cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      theme: { background: "#161422", foreground: "#ede9fc", cursor: "#c3b6ff" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    const id = crypto.randomUUID();
    let live = true;
    let connected = false;
    let writeQueue = Promise.resolve();
    const input = term.onData((data) => {
      writeQueue = writeQueue.then(() => invoke<void>("write_terminal", { terminalId: id, input: data }))
        .catch((cause: unknown) => { if (live) setError(String(cause)); });
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    fit.fit();
    const resize = term.onResize(({ rows, cols }) => {
      if (connected) void invoke("resize_terminal", { terminalId: id, rows, cols }).catch(() => {});
    });
    const subscriptions = Promise.all([
      listen<{ id: string; chunk: string }>("terminal-output", ({ payload }) => {
        if (live && payload.id === id) term.write(Uint8Array.from(atob(payload.chunk), (char) => char.charCodeAt(0)));
      }),
      listen<string>("terminal-exit", ({ payload }) => {
        if (live && payload === id) { connected = false; onClose(); }
      }),
    ]);
    const start = subscriptions.then(async () => {
      if (!live) return;
      connected = true;
      await invoke("start_terminal", { terminalId: id, rows: term.rows, cols: term.cols });
      if (live) term.focus();
    }).catch((cause: unknown) => { if (live) setError(String(cause)); });
    return () => {
      live = false;
      connected = false;
      observer.disconnect();
      resize.dispose();
      input.dispose();
      term.dispose();
      void subscriptions.then((listeners) => listeners.forEach((unlisten) => unlisten())).catch(() => {});
      void start.then(() => invoke("stop_terminal", { terminalId: id })).catch(() => {});
    };
  }, []);

  // Dragging the left border resizes the pane; the board keeps at least 300px.
  function drag(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setWidth(Math.max(290, Math.min(window.innerWidth - event.clientX, window.innerWidth - 300)));
  }

  return <aside className="terminal-pane" aria-label="Terminal" style={{ width }}>
    <div className="terminal-resize" role="separator" aria-orientation="vertical" aria-label="Resize terminal"
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={drag} />
    <button className="terminal-close" onClick={onClose} aria-label="Close terminal">×</button>
    <div ref={host} className="terminal-host" />
    {error && <p className="pane-error" role="alert">{error}</p>}
  </aside>;
}
