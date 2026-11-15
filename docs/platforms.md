# Desktop compatibility

This guide explains what changes across operating systems and how to test a packaged preview. For downloads and setup, start with the [project README](../README.md).

| Target | What the app uses | What the installer or setup handles |
| --- | --- | --- |
| macOS 13+ on Apple silicon and Intel | WKWebView, a macOS microphone permission prompt, and a Unix terminal running Zsh. The app declares microphone use in [`Info.plist`](../src-tauri/Info.plist). | Two ad-hoc-signed app bundles. Homebrew provides FFmpeg and whisper.cpp. [Tauri webview versions](https://tauri.app/reference/webview-versions/) |
| Windows 11 x64 | WebView2 and a ConPTY terminal running the native `codex` or `claude` command. [The Windows configuration](../src-tauri/tauri.windows.conf.json) gives Excalidraw the image-drop events. | The NSIS installer can obtain the WebView2 runtime. FFmpeg comes from WinGet and the setup script installs a checked Whisper release. Grant desktop microphone access if Windows blocks recording. [Tauri installer options](https://v2.tauri.app/distribute/windows-installer/) · [Tauri drag-and-drop setting](https://tauri.app/reference/javascript/api/namespacewebview/#dragdropenabled) · [Microsoft microphone controls](https://support.microsoft.com/en-us/windows/privacy/turn-on-app-permissions-for-your-microphone-in-windows) |
| Ubuntu 24.04 or Debian 13 x64 | WebKitGTK, GStreamer, and a Unix terminal running Bash. The Rust app grants microphone capture only to its own board webview. | The Debian package pulls the media and audio-input plugins from the system package manager. The setup script installs and checks the upstream Whisper executable and the English model. [Tauri Debian packages](https://v2.tauri.app/distribute/debian/) · [Wry's WebKitGTK permission handler](https://github.com/tauri-apps/wry/blob/wry-v0.57.2/src/webkitgtk/mod.rs) |

The three systems use the same canvas, recording, and transcript code. [`recording.ts`](../src/recording.ts) asks the webview which format it can record. It tries MP4 first and can fall back to WebM. WebKitGTK added WebM recording in 2.48 and requires GStreamer 1.24.9 or newer for that format. Ubuntu 24.04 ships GStreamer 1.24.2, so its MP4 encoder path matters. [`recording.rs`](../src-tauri/src/recording.rs) converts either capture format to H.264/AAC MP4 before replay. Keeping one output format also lets both tutors read the same filenames and seek to the same timestamps. [WebKitGTK 2.48 release notes](https://webkitgtk.org/2025/03/14/webkitgtk2.48.0-released.html) · [Ubuntu GStreamer package](https://packages.ubuntu.com/noble/libgstreamer1.0-0)

System runtimes and packaging matter. The Linux artifact targets Debian-family desktops with the listed minimum system libraries. Other distributions can build from source using their equivalent dependencies. Both Windows and Linux setup scripts verify the upstream Whisper archive and the model before installation. The Windows and Linux launchers can find those tools inside the app's data folder without editing the user's shell profile. [Whisper binaries and checksums](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454)

## Verify a preview on a desktop

1. Drop a worksheet photo onto the board. Draw, erase, undo, and reopen the app to check local saving.
2. Record five seconds while drawing and speaking. Stop, wait for transcription, and click a transcript timestamp. Check that the relevant board action is visible and the audio is audible.
3. Open **Ask** with each installed tutor. Check that the terminal launches and the study folder contains `recording.mp4` and `transcript.txt`. Type a question and check that the tutor can refer to the steps in the recording.

[GitHub Actions](https://github.com/ethanramli/excali-tutor/actions/workflows/desktop.yml) verifies packaging and runs the Rust and TypeScript tests on the four targets. The Linux job also checks the installed codecs and starts the desktop binary under a virtual display. A build or startup check leaves a real microphone, local permissions, and authenticated tutor sessions for the desktop test above.
