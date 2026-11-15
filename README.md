# Excali Tutor

Work through a math or physics problem with the real Excalidraw pen, eraser, undo, and redo. Circle a step for a quick question or record yourself explaining a solution. When you open **Ask**, Codex or Claude Code has the board and study materials ready while you write your own question.

## Install the desktop preview

Open the latest successful [desktop preview build](https://github.com/ethanramli/excali-tutor/actions/workflows/desktop.yml). Scroll to **Artifacts**, download the file for your system, and extract it.

| System | Artifact | Install and set up offline transcription |
| --- | --- | --- |
| Mac with Apple silicon or Intel | `Excali-Tutor-macOS-apple-silicon` or `Excali-Tutor-macOS-intel` | Extract the inner zip. With [Homebrew](https://brew.sh) installed, run `bash setup-mac.sh` in that folder, then open **Excali Tutor.app**. Allow microphone access when recording. The preview is ad-hoc signed. You can build from source if macOS blocks the downloaded app. |
| Windows 11 x64 | `Excali-Tutor-Windows-x64` | Run the installer. In PowerShell run `winget install --exact --id Gyan.FFmpeg`, then open a new PowerShell window in the extracted folder and run `.\setup-windows.ps1`. If Windows marks the script as downloaded, review the file and use `Unblock-File -LiteralPath .\setup-windows.ps1` before running it. |
| Ubuntu 24.04 or Debian 13 x64 | `Excali-Tutor-Linux-x64-deb` | In a terminal in the extracted folder, run `sudo apt install ./excali-tutor_*.deb curl`, then `bash setup-linux.sh`. Open **Excali Tutor** from your app menu. |

Setup downloads an English model around 142 MiB. On Windows, if Whisper reports a missing runtime, install the [Microsoft Visual C++ x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) and rerun setup. If the microphone is blocked, check the system microphone setting and selected input. [Platform details and troubleshooting](docs/platforms.md)

For tutoring, install and sign in to [Codex](https://developers.openai.com/codex/cli) or [Claude Code](https://code.claude.com/docs/en/setup) from your regular terminal. Confirm that `codex --version` or `claude --version` works before opening **Ask**. On Windows use the native CLI in PowerShell or Command Prompt.

### Build from source

Install Node.js 22 or newer and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system. Follow the relevant transcription setup above with the script in [`scripts/`](scripts). On Ubuntu or Debian, source builds also need the FFmpeg and GStreamer packages listed in the [Linux bundle configuration](src-tauri/tauri.linux.conf.json).

```sh
npm ci
npm run tauri dev
```

For a local package run `npm run tauri -- build --bundles app -- --locked` on macOS, replace `app` with `nsis` on Windows or with `deb` on Ubuntu or Debian. Packages are in `src-tauri/target/release/bundle/`.

## Study workflows

- **Write and save.** Open and export portable `.excalidraw` files. Drag or paste images onto the canvas. The working board and its images autosave to disk. Photos are saved separately so an ink stroke does not rewrite every image.
- **Ask about a step.** Click **Circle**, draw around a region, then hit **Ask**. The tutor receives a crop, a viewport image, and the editable Excalidraw scene. A temporary circle stays out of drawing history.
- **Explain a solution.** Press **⌘⇧R** on Mac or **Ctrl+Shift+R** on Windows and Linux to start or stop recording the board and mic. The app encodes the video and transcribes in English on the computer. Click a transcript timestamp to jump in **Replay**.
- **Ask about a recording.** Press **⌘⇧A** on Mac, **Ctrl+Shift+A** on Windows and Linux, or **Ask about recording** in Replay. The tutor terminal opens in a study folder with the full `recording.mp4`, `transcript.txt`, and the board. Type your question, use **Insert** to put the draft in the terminal, then press Enter at the CLI prompt. For CLIs that take images, the folder also has preview frames and the prompt tells the CLI how to extract a frame at any requested time from the original video.
- **Apply an edit.** Ask the tutor to save an annotation and click **Apply tutor edit**. This applies its proposed scene as an undoable edit. If you changed the board since the tutor received it, reopen Ask to refresh its context first.

The recorder captures the drawing area and pointer, plus microphone audio. Boards and recordings stay in the desktop app’s local data directory. The tutor reads the selected study materials when you submit a question using its normal account and usage allowance. Transcription is free to run offline after setup.

## Project map

- [`src/`](src) has the board, capture canvas, replay and terminal UI. [`recording.ts`](src/recording.ts) starts and stops board-and-mic capture and streams video chunks to Rust.
- [`src-tauri/`](src-tauri) has the Rust desktop backend and permission/configuration files. [`recording.rs`](src-tauri/src/recording.rs) normalizes the video and runs offline transcription. [`terminal.rs`](src-tauri/src/terminal.rs) connects Claude Code and Codex to a local pseudoterminal.
- [`scripts/`](scripts) installs the offline speech tools and model. Start with [`setup-windows.ps1`](scripts/setup-windows.ps1), [`setup-linux.sh`](scripts/setup-linux.sh), or [`setup-mac.sh`](scripts/setup-mac.sh).
- [`docs/`](docs) records platform decisions and how to verify each port. Start with [`platforms.md`](docs/platforms.md).
- [`.github/workflows/`](.github/workflows) packages native previews. Run [`desktop.yml`](.github/workflows/desktop.yml) manually when you need new downloads.

Run `npm test` for UI utility tests and `cargo test --manifest-path src-tauri/Cargo.toml --locked` for native backend tests.

Excali Tutor is licensed under [MIT](LICENSE). Excalidraw and whisper.cpp are separate upstream projects.
