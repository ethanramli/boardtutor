import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu, getSceneVersion } from "@excalidraw/excalidraw";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import { readScene, serializeBoard, type BoardAPI, type BoardData } from "./board";
import { BoardList, BoardsContext } from "./Boards";
import { drawOnBoard, eraseFromBoard, lookAtBoard } from "./boardTools";
import { listen } from "@tauri-apps/api/event";
import { baseName, byName, isInside, joinPath, movedPath, parentOf, targetFolder, uniquePath, type Entry } from "./tree";
import { TerminalPane } from "./Terminal";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";

declare global {
  interface Window { EXCALIDRAW_ASSET_PATH: string }
}
window.EXCALIDRAW_ASSET_PATH = new URL("./", window.location.href).href;

const encode = (text: string) => new TextEncoder().encode(text);
const shortcut = /Mac/i.test(navigator.platform) ? "⌘⇧" : "Ctrl+Shift+";

function TerminalIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3" /><path d="M13 15h4" />
  </svg>;
}

function App() {
  const [initial, setInitial] = useState<{ data: BoardData | undefined } | null>(null);
  const [error, setError] = useState("");
  const [boards, setBoards] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const api = useRef<BoardAPI | null>(null);
  const opened = useRef(false);
  const switching = useRef(false);
  const currentRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const savedSignature = useRef("");
  const savedImages = useRef(new Map<string, string>());

  useEffect(() => {
    void (async () => {
      const entries = await invoke<Entry[]>("list_boards");
      const names = entries.filter((entry) => !entry.folder).map((entry) => entry.path).sort(byName);
      setFolders(entries.filter((entry) => entry.folder).map((entry) => entry.path));
      const remembered = localStorage.getItem("current-board");
      const name = remembered && names.includes(remembered) ? remembered : names[0] ?? "board";
      const text = await invoke<string | null>("open_board", { name });
      currentRef.current = name;
      setBoards(names.includes(name) ? names : [...names, name].sort(byName));
      setCurrent(name);
      setInitial({ data: text ? readScene(text) : undefined });
    })().catch((cause: unknown) => setError(`Could not load the local board. ${String(cause)}`));
  }, []);

  function flushBoard() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const current = api.current;
    const name = currentRef.current;
    if (!current || !name) return saves.current;
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
      await invoke<void>("save_board", bytes, { headers: { "x-board-name": encodeURIComponent(name) } });
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
    timer.current = setTimeout(() => {
      void flushBoard().catch((cause: unknown) => {
        savedSignature.current = "";
        setError(`Could not save the board. ${String(cause)}`);
      });
    }, 350);
  }

  useEffect(() => {
    let allowClose = false;
    const subscribe = getCurrentWindow().onCloseRequested(async (event) => {
      if (allowClose) return;
      event.preventDefault();
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

  // Saves the board you are leaving, then opens the other one.
  async function openBoard(name: string) {
    if (name === currentRef.current || switching.current) return;
    switching.current = true;
    try {
      await flushBoard();
      const text = await invoke<string | null>("open_board", { name });
      const data = text ? readScene(text) : undefined;
      api.current = null;
      savedSignature.current = "";
      currentRef.current = name;
      localStorage.setItem("current-board", name);
      setBoards((list) => list.includes(name) ? list : [...list, name].sort(byName));
      setCurrent(name);
      setBoardKey((key) => key + 1);
      setInitial({ data });
    } finally {
      switching.current = false;
    }
  }

  // Leaves a board that is about to be deleted or moved, so it is not saved back.
  async function leave(path: string) {
    const here = currentRef.current;
    if (!here || !isInside(here, path)) return;
    const other = boards.find((item) => !isInside(item, path));
    await openBoard(other ?? uniquePath(boards, "", "Board"));
  }

  async function deleteEntry(path: string, folder: boolean) {
    await leave(path);
    await invoke<void>("delete_entry", { path, folder });
    setBoards((list) => list.filter((item) => !isInside(item, path)));
    if (folder) setFolders((list) => list.filter((item) => !isInside(item, path)));
    setSelected((sel) => sel && isInside(sel, path) ? null : sel);
  }

  async function renameEntry(path: string, newBase: string, folder: boolean) {
    const to = joinPath(parentOf(path), newBase);
    const here = currentRef.current;
    if (here && isInside(here, path)) await flushBoard();
    await invoke<void>("rename_entry", { old: path, new: to, folder });
    setBoards((list) => list.map((item) => movedPath(item, path, to)).sort(byName));
    if (folder) setFolders((list) => list.map((item) => movedPath(item, path, to)).sort(byName));
    setSelected((sel) => sel && movedPath(sel, path, to));
    if (here && isInside(here, path)) {
      const next = movedPath(here, path, to);
      currentRef.current = next;
      localStorage.setItem("current-board", next);
      setCurrent(next);
    }
  }

  async function newBoardIn(dir: string) {
    setCollapsed((set) => { const next = new Set(set); next.delete(dir); return next; });
    await openBoard(uniquePath(boards, dir, "Board"));
  }

  async function newFolderIn(dir: string) {
    const path = uniquePath(folders, dir, "New folder");
    await invoke<void>("create_folder", { path });
    setFolders((list) => [...list, path].sort(byName));
    setCollapsed((set) => { const next = new Set(set); next.delete(dir); return next; });
    setRenaming(path);
  }

  async function exportBoard() {
    if (!api.current) return;
    const chosen = await save({ defaultPath: `${baseName(currentRef.current ?? "board")}.excalidraw`, filters: [{ name: "Excalidraw board", extensions: ["excalidraw"] }] });
    if (!chosen) return;
    const path = chosen.endsWith(".excalidraw") ? chosen : `${chosen}.excalidraw`;
    await invoke("write_board_file", encode(serializeBoard(api.current)), { headers: { "x-board-path": encodeURIComponent(path) } });
  }

  // Saves the board first, so the terminal sees what is on screen.
  async function openTerminal() {
    if (!api.current || opened.current) return;
    opened.current = true;
    try {
      await flushBoard();
      setTerminalOpen(true);
    } finally {
      opened.current = false;
    }
  }

  // Claude's board tools arrive from the backend; the open board answers them.
  useEffect(() => {
    const subscription = listen<{ id: string; name: string; args: Record<string, unknown> | null }>("board-tool", ({ payload }) => {
      void (async () => {
        const board = api.current;
        if (!board) throw new Error("No board is open yet.");
        if (payload.name === "look_at_board") {
          return lookAtBoard(board, currentRef.current ?? "", payload.args?.picture === true);
        }
        if (payload.name === "draw_on_board") return { text: await drawOnBoard(board, payload.args?.items as never), image: null };
        if (payload.name === "erase_from_board") return { text: await eraseFromBoard(board, payload.args?.ids as never), image: null };
        throw new Error(`Unknown tool ${payload.name}`);
      })().then(
        ({ text, image }) => invoke("board_tool_result", { id: payload.id, text, image }),
        (cause: unknown) => invoke("board_tool_result", { id: payload.id, text: `Error: ${String(cause)}`, image: null }),
      );
    });
    return () => { void subscription.then((unlisten) => unlisten()); };
  }, []);

  function run(action: () => Promise<unknown>) {
    setError("");
    void action().catch((cause: unknown) => setError(String(cause)));
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.repeat || event.code !== "KeyT") return;
      event.preventDefault();
      event.stopPropagation();
      run(openTerminal);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  return <main className="app">
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <div className="workspace">
      <section className="board">
        {initial && current ? <BoardsContext.Provider value={{
          boards, folders, current, selected, collapsed, renaming,
          open: (path) => run(() => openBoard(path)),
          select: setSelected,
          toggle: (folder) => setCollapsed((set) => { const next = new Set(set); if (!next.delete(folder)) next.add(folder); return next; }),
          rename: (path, newBase, folder) => run(() => renameEntry(path, newBase, folder)),
          remove: (path, folder) => run(() => deleteEntry(path, folder)),
          newBoard: (dir) => run(() => newBoardIn(dir ?? targetFolder(selected, folders))),
          newFolder: (dir) => run(() => newFolderIn(dir ?? targetFolder(selected, folders))),
          doneRenaming: () => setRenaming(null),
        }}><Excalidraw key={boardKey} excalidrawAPI={(value) => { api.current = value; }} initialData={initial.data}
          onChange={changed}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
          renderTopRightUI={() => <button type="button" aria-label="Open terminal"
            title={`Open terminal (${shortcut}T)`} onClick={() => run(openTerminal)}><TerminalIcon /></button>}>
            <MainMenu>
              <MainMenu.ItemCustom><BoardList /></MainMenu.ItemCustom>
              <MainMenu.Separator />
              <MainMenu.Item onSelect={() => run(exportBoard)}>Export board…</MainMenu.Item>
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
          </Excalidraw></BoardsContext.Provider>
          : <p className="board-loading">Opening local whiteboard…</p>}
      </section>
      {terminalOpen && <TerminalPane onClose={() => setTerminalOpen(false)} />}
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
