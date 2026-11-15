# Board Tutor

A plain Excalidraw whiteboard with a terminal beside it. Draw or work through a problem on the board, then click the terminal icon in the top bar (or press ⌘⇧T on Mac, Ctrl+Shift+T on Windows and Linux) and talk to Claude Code or any other command-line tool about what you drew.

## How it works

- The board is the normal Excalidraw, with its pen, eraser, undo and redo. It saves itself as you draw.
- On first launch the app creates a folder at `Documents/boardtutor` with three subfolders: `whiteboards/` for your boards, `memory/` for notes about how you like to learn, and `skills/` for teaching skills. A short `CLAUDE.md` in that folder tells Claude Code what each one is for.
- The terminal opens in that folder, so your board is at `whiteboards/board.excalidraw`. Drag the terminal's left edge to resize it.

## Build from source

Install Node.js 22 or newer and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system.

```sh
npm ci
npm run tauri dev
```

For a local package run `npm run tauri -- build --bundles app -- --locked` on macOS, replace `app` with `nsis` on Windows or with `deb` on Ubuntu or Debian. Packages are in `src-tauri/target/release/bundle/`. Run `cargo test --manifest-path src-tauri/Cargo.toml --locked` for the backend tests.

## Project map

- [`src/`](src) has the board and the terminal pane.
- [`src-tauri/`](src-tauri) has the Rust desktop backend. [`terminal.rs`](src-tauri/src/terminal.rs) connects the pane to a local shell.
- [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) builds the desktop previews.

Board Tutor is licensed under [MIT](LICENSE). Excalidraw is a separate upstream project.
