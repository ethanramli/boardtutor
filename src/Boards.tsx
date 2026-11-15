import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { baseName, childrenOf, targetFolder } from "./tree";

export type BoardsApi = {
  boards: string[];
  folders: string[];
  current: string | null;
  selected: string | null;
  collapsed: Set<string>;
  renaming: string | null;
  open: (path: string) => void;
  select: (path: string | null) => void;
  toggle: (folder: string) => void;
  rename: (path: string, newBase: string, folder: boolean) => void;
  remove: (path: string, folder: boolean) => void;
  newBoard: (dir?: string) => void;
  newFolder: (dir?: string) => void;
  doneRenaming: () => void;
};

// Context reaches the menu even though Excalidraw renders its children itself.
export const BoardsContext = createContext<BoardsApi>({
  boards: [], folders: [], current: null, selected: null, collapsed: new Set(), renaming: null,
  open: () => {}, select: () => {}, toggle: () => {}, rename: () => {}, remove: () => {},
  newBoard: () => {}, newFolder: () => {}, doneRenaming: () => {},
});

const icon = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const FolderIcon = () => <svg {...icon}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>;
const FileIcon = () => <svg {...icon}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></svg>;

function IconButton({ label, onClick, className = "board-action", children }: {
  label: string; onClick: () => void; className?: string; children: ReactNode;
}) {
  return <button className={className} aria-label={label} title={label}
    onClick={(event) => { event.stopPropagation(); onClick(); }}>{children}</button>;
}

// One row: arrow, icon, name, and a single "⋮" slot that appears on hover.
function Row({ path, folder }: { path: string; folder: boolean }) {
  const api = useContext(BoardsContext);
  const name = baseName(path);
  const [text, setText] = useState<string | null>(api.renaming === path ? name : null);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const closed = api.collapsed.has(path);

  useEffect(() => { if (api.renaming === path) api.doneRenaming(); }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!rowRef.current?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  function finish(commit: boolean) {
    const next = text?.trim();
    if (commit && next && next !== name) api.rename(path, next, folder);
    setText(null);
  }

  function act(action: () => void) { setMenu(null); action(); }

  const classes = ["board-row"];
  if (!folder && path === api.current) classes.push("active");
  if (path === api.selected) classes.push("selected");
  if (menu || confirming) classes.push("open");

  return <div ref={rowRef} className={classes.join(" ")}
    onClick={(event) => {
      event.stopPropagation();
      if (text !== null || confirming) return;
      api.select(path);
      if (folder) api.toggle(path); else api.open(path);
    }}>
    <span className="board-chevron" aria-hidden="true">{folder ? (closed ? "▸" : "▾") : ""}</span>
    <span className="board-icon">{folder ? <FolderIcon /> : <FileIcon />}</span>
    {text !== null
      ? <input className="board-name-input" autoFocus value={text} aria-label={`Rename ${name}`}
          onClick={(event) => event.stopPropagation()}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(event.target.value)} onBlur={() => finish(true)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") finish(true);
            if (event.key === "Escape") finish(false);
          }} />
      : confirming
        ? <span className="board-name board-confirm">Move to Trash?</span>
        : <span className="board-name" aria-current={!folder && path === api.current ? "true" : undefined}
            aria-expanded={folder ? !closed : undefined}>{name}</span>}
    <div className="board-actions">
      {confirming
        ? <>
            <IconButton label={`Confirm delete ${name}`} className="board-action danger"
              onClick={() => { setConfirming(false); api.remove(path, folder); }}>
              <svg {...icon}><path d="M5 12l5 5L20 7" /></svg></IconButton>
            <IconButton label="Cancel" onClick={() => setConfirming(false)}>
              <svg {...icon}><path d="M6 6l12 12M18 6L6 18" /></svg></IconButton>
          </>
        : text === null && <IconButton label={`More actions for ${name}`} className="board-action board-more"
            onClick={() => {
              const box = rowRef.current!.getBoundingClientRect();
              setMenu(menu ? null : { x: box.right - 170, y: box.bottom + 2 });
            }}>
            <svg {...icon}><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
          </IconButton>}
    </div>
    {menu && <div className="board-popover" role="menu" style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}>
      {folder && <>
        <button role="menuitem" onClick={() => act(() => { api.select(path); api.newBoard(path); })}>New board here</button>
        <button role="menuitem" onClick={() => act(() => { api.select(path); api.newFolder(path); })}>New folder here</button>
      </>}
      <button role="menuitem" onClick={() => act(() => setText(name))}>Rename</button>
      <button role="menuitem" className="danger" onClick={() => act(() => setConfirming(true))}>Delete</button>
    </div>}
  </div>;
}

function Branch({ dir }: { dir: string }) {
  const { boards, folders, collapsed } = useContext(BoardsContext);
  const kids = childrenOf(boards, folders, dir);
  return <>
    {kids.folders.map((path) => <div key={`f:${path}`}>
      <Row path={path} folder />
      {!collapsed.has(path) && <div className="board-children"><Branch dir={path} /></div>}
    </div>)}
    {kids.boards.map((path) => <Row key={`b:${path}`} path={path} folder={false} />)}
  </>;
}

export function BoardList() {
  const api = useContext(BoardsContext);
  const target = targetFolder(api.selected, api.folders);
  return <div className="board-panel">
    <div className="board-header">
      <span title={target ? `New items go in ${target}` : "New items go in whiteboards"}>
        Boards{target && <span className="board-target"> · {baseName(target)}</span>}</span>
      <IconButton label="New board" onClick={() => api.newBoard()}>
        <svg {...icon}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M12 12v6M9 15h6" /></svg></IconButton>
      <IconButton label="New folder" onClick={() => api.newFolder()}>
        <svg {...icon}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 10v6M9 13h6" /></svg></IconButton>
    </div>
    {/* Clicking empty space clears the selection, so new items go to the top. */}
    <div className="board-list" aria-label="Boards" onClick={() => api.select(null)}>
      <Branch dir="" />
    </div>
  </div>;
}
