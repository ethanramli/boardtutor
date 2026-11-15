# Excali Tutor

Work through a math or physics problem with the real Excalidraw pen, eraser, undo, and redo. Circle a step for a quick question or record yourself explaining a solution. When you open **Ask**, Codex or Claude Code has the board and study materials ready while you write your own question.

## Try it on a Mac

1. Open [macOS preview builds](https://github.com/ethanramli/excali-tutor/actions/workflows/macos.yml). Open the latest successful run, get the artifact for **Apple silicon** or **Intel**, and unzip the preview archive inside it.
2. With [Homebrew](https://brew.sh) installed, open Terminal in the extracted preview folder and run `bash setup-mac.sh`. This installs FFmpeg and whisper.cpp and downloads the verified English model, around 142 MiB, once.
3. Open **Excali Tutor.app** and grant microphone access when prompted. The preview has an ad-hoc signature. If macOS refuses to open a downloaded preview, use the source build below or follow Apple's guidance for opening apps from an identified source you trust.
4. To use a tutor, install [Codex](https://developers.openai.com/codex/cli) or [Claude Code](https://code.claude.com/docs/en/setup) and sign in to it in your normal terminal first. Confirm `codex --version` or `claude --version` works there.

### Build from source

Install Node.js 22 or newer and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), including the Xcode command-line tools and Rust on macOS. Run from the checkout:

```sh
bash scripts/setup-mac.sh
npm ci
npm run tauri dev
```

To create the macOS application bundle locally, run `npm run tauri -- build --bundles app -- --locked`. The bundle is at `src-tauri/target/release/bundle/macos/Excali Tutor.app`.

## Study workflows

- **Write and save.** Open and export portable `.excalidraw` files. Drag or paste images onto the canvas. The working board and its images autosave to disk. Photos are saved separately so an ink stroke does not rewrite every image.
- **Ask about a step.** Click **Circle**, draw around a region, then hit **Ask**. The tutor receives a crop, a viewport image, and the editable Excalidraw scene. A temporary circle stays out of drawing history.
- **Explain a solution.** Press **⌘⇧R** to start or stop recording the board and mic. The app encodes the video and transcribes in English on the computer. Click a transcript timestamp to jump in **Replay**.
- **Ask about a recording.** Press **⌘⇧A** or **Ask about recording** in Replay. The tutor terminal opens in a study folder with the full `recording.mp4`, `transcript.txt`, and the board. Type your question, use **Insert** to put the draft in the terminal, then press Enter at the CLI prompt. For CLIs that take images, the folder also has preview frames and the prompt tells the CLI how to extract a frame at any requested time from the original video.
- **Apply an edit.** Ask the tutor to save an annotation and click **Apply tutor edit**. This applies its proposed scene as an undoable edit. If you changed the board since the tutor received it, reopen Ask to refresh its context first.

The recorder captures the drawing area and pointer, plus microphone audio. Boards and recordings stay in the desktop app’s local data directory. The tutor reads the selected study materials when you submit a question using its normal account and usage allowance. Transcription is free to run offline after setup.

## Platform rollout

macOS is first. Windows is next, then Linux. The UI and Rust backend share a codebase. Media capture, replay codecs, terminal discovery, and packaging need a real smoke test on each platform before its preview ships.

## Project map

- [`src/`](src) has the board, capture canvas, replay and terminal UI. [`recording.ts`](src/recording.ts) starts and stops board-and-mic capture and streams video chunks to Rust.
- [`src-tauri/`](src-tauri) has the Rust desktop backend and permission/configuration files. [`recording.rs`](src-tauri/src/recording.rs) normalizes the video and runs offline transcription. [`terminal.rs`](src-tauri/src/terminal.rs) connects Claude Code and Codex to a local pseudoterminal.
- [`scripts/`](scripts) contains the one-time Mac setup. [`.github/workflows/macos.yml`](.github/workflows/macos.yml) builds both Mac app bundles as downloadable preview artifacts.

Run `npm test` for UI utility tests and `cargo test --manifest-path src-tauri/Cargo.toml --locked` for native backend tests.

Excali Tutor is licensed under [MIT](LICENSE). Excalidraw and whisper.cpp are separate upstream projects.
