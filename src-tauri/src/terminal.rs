use crate::{error, tutor_dir, valid_id, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    io::{Read, Write},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, State};

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    id: String,
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[derive(Default)]
pub struct Session(Mutex<Option<Terminal>>);

#[derive(Clone, Serialize)]
struct TerminalEvent {
    id: String,
    chunk: String,
}

fn size(rows: u16, cols: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 300),
        cols: cols.clamp(2, 500),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    session: State<'_, Session>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<()> {
    valid_id(&terminal_id)?;
    let dir = tutor_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(error)?;
    let pair = native_pty_system()
        .openpty(size(rows, cols))
        .map_err(error)?;
    let mut cmd = if cfg!(windows) {
        let mut shell = CommandBuilder::new("cmd.exe");
        // Keep npm .cmd shims and native .exe installs usable through PATH.
        shell.env("NoDefaultCurrentDirectoryInExePath", "1");
        shell
    } else {
        let mut shell = CommandBuilder::new(if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        });
        if let Some(home) = std::env::var_os("HOME") {
            let local_bin = std::path::PathBuf::from(home).join(".local/bin");
            let inherited = std::env::var_os("PATH").unwrap_or_default();
            if let Ok(path) = std::env::join_paths(
                std::iter::once(local_bin).chain(std::env::split_paths(&inherited)),
            ) {
                shell.env("PATH", path);
            }
        }
        shell.arg("-il");
        shell
    };
    cmd.cwd(dir);
    cmd.env("TERM", "xterm-256color");
    // Stop macOS from restoring Terminal.app sessions inside this shell.
    cmd.env("SHELL_SESSIONS_DISABLE", "1");
    cmd.env_remove("CLAUDECODE");
    let mut reader = pair.master.try_clone_reader().map_err(error)?;
    let writer = pair.master.take_writer().map_err(error)?;
    let mut current = session.0.lock().map_err(error)?;
    current.take();
    let child = pair.slave.spawn_command(cmd).map_err(error)?;
    drop(pair.slave);
    let event_id = terminal_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0; 8192];
        while let Ok(count) = reader.read(&mut buf) {
            if count == 0 {
                break;
            }
            let payload = TerminalEvent {
                id: event_id.clone(),
                chunk: STANDARD.encode(&buf[..count]),
            };
            if app.emit("terminal-output", payload).is_err() {
                break;
            }
        }
        let _ = app.emit("terminal-exit", event_id);
    });
    *current = Some(Terminal {
        master: pair.master,
        child,
        writer,
        id: terminal_id,
    });
    Ok(())
}

#[tauri::command]
pub fn write_terminal(
    session: State<'_, Session>,
    terminal_id: String,
    input: String,
) -> Result<()> {
    let mut state = session.0.lock().map_err(error)?;
    if let Some(terminal) = state.as_mut().filter(|terminal| terminal.id == terminal_id) {
        terminal.writer.write_all(input.as_bytes()).map_err(error)?;
        terminal.writer.flush().map_err(error)?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_terminal(
    session: State<'_, Session>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<()> {
    let state = session.0.lock().map_err(error)?;
    if let Some(terminal) = state.as_ref().filter(|terminal| terminal.id == terminal_id) {
        terminal.master.resize(size(rows, cols)).map_err(error)?;
    }
    Ok(())
}

#[tauri::command]
pub fn stop_terminal(session: State<'_, Session>, terminal_id: String) -> Result<()> {
    let mut state = session.0.lock().map_err(error)?;
    if state
        .as_ref()
        .is_some_and(|terminal| terminal.id == terminal_id)
    {
        state.take();
    }
    Ok(())
}
