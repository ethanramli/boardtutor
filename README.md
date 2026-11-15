# excali-tutor

Excali Tutor is a planned desktop study app built around the Excalidraw editor. Work through a math or physics problem on a whiteboard, then show a tutor exactly where you got stuck.

## Study workflow

- Use Excalidraw’s pen, eraser, undo, and redo with their familiar shortcuts. Save boards and worksheet images locally and keep portable `.excalidraw` import and export.
- For a quick question, circle a line or diagram and press **Ask**. The tutor receives the circled area and surrounding board context. The temporary circle is independent of drawing history.
- For a worked solution, toggle recording with a shortcut. Capture the board and mic on the same timeline. Transcribe the audio locally with `whisper.cpp` and show the transcript as text with clickable timestamps.
- Press **Ask** to provide both the full board recording and the timestamped transcript to the selected tutor in the built-in terminal. Support Claude Code and Codex. If a CLI cannot directly interpret video, include timestamped frames for inspection and keep the original recording accessible.
- Let the tutor point to a step or add an undoable annotation when asked. Keep normal tutoring replies in the terminal.

Recordings, images, and transcripts are saved locally. Transcription runs offline after the model is installed and does not require an API key or paid inference. Asking a tutor uses that tutor’s normal service and usage allowance.

## First milestone

Open a worksheet with images, solve part of it by hand, and record a short explanation. Stop recording and verify that transcript timestamps jump to the matching moments in the video. Use **Ask** with each CLI and verify that it receives both artifacts and can ground feedback in the recorded work. Reopen the board and check that the images and working persist.

**Status** · Repository initialized. App implementation is pending.
