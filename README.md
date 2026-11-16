# boardtutor

A plain Excalidraw whiteboard with Claude Code beside it. Work through a problem on the board, open the terminal, and ask Claude about it. Claude can look at your board and draw on it while you watch: a red **Claude** cursor writes text, sketches with the pencil, and adds arrows and shapes, right next to your own work.

## What it costs

Claude draws through three small tools (`look_at_board`, `draw_on_board`, `erase_from_board`) instead of reading and rewriting board files or taking screenshots. Only short commands like `text 120,80 "F = ma"` travel; the app draws them.

| Request | Model | Result | Cost |
| --- | --- | --- | --- |
| "draw a rocket and label its parts" | Haiku 5.5 | Rocket with title, 6 labels and arrows, 19 s | **$0.0084** |
| A rocket, before the board tools existed | not recorded | Nothing drawn; Claude spent the request searching for the board file | $0.30 |

Both numbers are from Claude Code's usage screen on 2026-11-15. They are single runs, and the second used a different setup and possibly a different model, so read them as one example rather than a benchmark. Choosing a cheaper model with `/model` lowers the cost further.

## Install

1. **Download.** Open the latest run of [Desktop previews](.github/workflows/desktop.yml) under the repository's Actions tab, scroll to **Artifacts**, and download the file for your system. A maintainer starts that build with **Run workflow**.
2. **macOS only: let the app open.** The preview is not signed with an Apple Developer ID, so macOS may say it is damaged or from an unidentified developer. Move **Board Tutor.app** to Applications, then run this once in Terminal:
   ```sh
   xattr -dr com.apple.quarantine "/Applications/Board Tutor.app"
   ```
3. **Install Claude Code** and sign in, following [its setup guide](https://code.claude.com/docs/en/setup). Check that `claude --version` works in a normal terminal.

Windows and Linux builds are produced by the same workflow but have not been tested by hand yet.

## First run

Everything else is set up by the app when it starts:

- It creates `Documents/boardtutor` with `whiteboards/` (your boards and folders), `memory/` (notes about how you like to learn) and `skills/` (teaching skills).
- It writes the connection for Claude's board tools (`.mcp.json`) and a settings file that pre-approves them (`.claude/settings.json`).
- It keeps an up-to-date guide for Claude in `.boardtutor/guide.md`, which `CLAUDE.md` imports. Add your own notes for Claude below the first line of `CLAUDE.md`; the app never overwrites them.

Open the terminal with the icon at the top right (⌘⇧T on Mac, Ctrl+Shift+T elsewhere) and type `claude`. The first time, Claude Code asks whether you trust the folder; choose yes. Then ask something like "draw a rocket and label its parts". Start `claude` after the app is open, since that is when it picks up the board tools.

## Using the board

- The menu at the top left lists your boards and folders. The two icons in its header make a new board or folder inside the folder you last clicked, or at the top if you clicked empty space. Hover a row and use **⋮** to rename it, delete it (it goes to the Trash), or add something inside a folder.
- Boards save as you draw. Everything Claude draws is one undo step (⌘Z).
- Drag the terminal's left edge to resize it.

## Build from source

Install Node.js 22 or newer and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system.

```sh
npm ci
npm run tauri dev
```

For a package run `npm run tauri -- build --bundles app -- --locked` on macOS; replace `app` with `nsis` on Windows or `deb` on Ubuntu or Debian. Packages are in `src-tauri/target/release/bundle/`. Tests: `npm test` for the board-path logic and `cargo test --manifest-path src-tauri/Cargo.toml --locked` for the backend.

## Project map

- [`src/`](src) is the window you see. [`main.tsx`](src/main.tsx) runs the board and saving, [`Boards.tsx`](src/Boards.tsx) is the boards menu, [`boardTools.ts`](src/boardTools.ts) carries out Claude's look, draw and erase requests, and [`Terminal.tsx`](src/Terminal.tsx) is the terminal pane.
- [`src-tauri/`](src-tauri) is the Rust backend. [`main.rs`](src-tauri/src/main.rs) saves boards and sets up `Documents/boardtutor`, [`board_tools.rs`](src-tauri/src/board_tools.rs) is the local server that gives Claude Code its board tools, and [`terminal.rs`](src-tauri/src/terminal.rs) runs the shell in the terminal pane.
- [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) builds the downloadable previews for macOS, Windows and Linux.
- [`.agents/skills/`](.agents/skills) holds the agent skills used to build this project, such as [Ponytail](.agents/skills/ponytail/SKILL.md) for code changes.

Board Tutor is licensed under [MIT](LICENSE). Excalidraw is a separate upstream project.
