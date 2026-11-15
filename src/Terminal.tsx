import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { tutorPrompt, type AskContext, type Tutor } from "./study";

export function TerminalPane({ context, tutor, onClose, onApply }: {
  context: AskContext;
  tutor: Tutor;
  onClose: () => void;
  onApply: () => void;
}) {
  const div = useRef<HTMLDivElement>(null);
  const terminal = useRef<XTerm | null>(null);
  const connection = useRef<string | null>(null);
  const questionBox = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [error, setError] = useState("");
  useEffect(() => {
    const host = div.current!;
    const term = new XTerm({
      rows: 18, fontSize: 12, cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      theme: { background: "#161422", foreground: "#ede9fc", cursor: "#c3b6ff" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    terminal.current = term;
    const id = crypto.randomUUID();
    let live = true;
    let writeQueue = Promise.resolve();
    const input = term.onData((input) => {
      writeQueue = writeQueue.then(() => invoke<void>("write_terminal", { terminalId: id, input }))
        .catch((cause: unknown) => { if (live) setError(String(cause)); });
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    fit.fit();
    const resize = term.onResize(({ rows, cols }) => {
      if (connection.current === id) void invoke("resize_terminal", { terminalId: id, rows, cols }).catch(() => {});
    });
    const subscriptions = Promise.all([
      listen<{ id: string; chunk: string }>("terminal-output", ({ payload }) => {
        if (live && payload.id === id) term.write(Uint8Array.from(atob(payload.chunk), (char) => char.charCodeAt(0)));
      }),
      listen<string>("terminal-exit", ({ payload }) => {
        if (live && payload === id) {
          connection.current = null;
          setStatus("closed");
          term.writeln("\r\nTutor exited. If its command was missing, install it and sign in in your normal terminal, then open Ask again.");
        }
      }),
    ]);
    let exited = false;
    const start = subscriptions.then(async () => {
      if (!live) return;
      connection.current = id;
      await invoke("start_terminal", { contextId: context.id, terminalId: id, tutor, rows: term.rows, cols: term.cols });
      exited = connection.current !== id;
      if (live && !exited) {
        setStatus("open");
        questionBox.current?.focus();
      }
    }).catch((cause: unknown) => {
      if (live) { setStatus("closed"); setError(String(cause)); }
    });
    return () => {
      live = false;
      if (connection.current === id) connection.current = null;
      observer.disconnect();
      resize.dispose();
      input.dispose();
      term.dispose();
      terminal.current = null;
      void subscriptions.then((listeners) => listeners.forEach((unlisten) => unlisten())).catch(() => {});
      void start.then(() => invoke("stop_terminal", { terminalId: id })).catch(() => {});
    };
  }, [context.id, tutor]);

  function insert(event: FormEvent) {
    event.preventDefault();
    if (status !== "open" || !question.trim()) return;
    // Let the user review the CLI input and press Enter there. This also avoids
    // sending study text to any CLI startup prompt.
    terminal.current?.paste(tutorPrompt(context, question));
    terminal.current?.focus();
  }

  return <aside className="terminal-pane" aria-label="Tutor">
    <div className="pane-title">
      <strong>{tutor === "claude" ? "Claude Code" : "Codex"}</strong>
      <button onClick={onClose} aria-label="Close tutor">×</button>
    </div>
    <div className="attachment-row" title={context.path}>
      {context.recorded
        ? <><span>recording.mp4</span><span>transcript.txt</span></>
        : <span>{context.focused ? "circled.png" : "board.png"}</span>}
      <span>board.excalidraw</span>
    </div>
    <div ref={div} className="terminal-host" />
    {error && <p className="pane-error" role="alert">{error}</p>}
    <form className="question-form" onSubmit={insert}>
      <input ref={questionBox} value={question} onChange={(event) => setQuestion(event.target.value)}
        placeholder="What are you stuck on?" aria-label="Tutor question" />
      <button disabled={status !== "open" || !question.trim()} type="submit">Insert</button>
    </form>
    <div className="pane-footer"><span>Review in the terminal, then press Enter there.</span><button onClick={onApply}>Apply tutor edit</button></div>
  </aside>;
}
