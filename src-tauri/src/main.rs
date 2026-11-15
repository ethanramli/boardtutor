#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod board_tools;
mod terminal;

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Manager,
};
use uuid::Uuid;

pub(crate) type Result<T> = std::result::Result<T, String>;

pub(crate) fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path().app_data_dir().map_err(error)
}

pub(crate) fn valid_id(id: &str) -> Result<()> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "Invalid session ID.".into())
}

pub(crate) fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Invalid file path.")?;
    fs::create_dir_all(parent).map_err(error)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    temp.write_all(bytes).map_err(error)?;
    temp.persist(path).map_err(error)?;
    Ok(())
}

pub(crate) fn binary<'a>(request: &'a Request<'_>) -> Result<&'a [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("Expected binary data.".into()),
    }
}

pub(crate) fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("Missing {name} header."))
}

fn image_path(root: &Path, id: &str) -> PathBuf {
    root.join("board-images")
        .join(format!("{:x}.json", Sha256::digest(id.as_bytes())))
}

fn hydrate_board(root: &Path, serialized: &str) -> Result<String> {
    let mut board: Value = serde_json::from_str(serialized).map_err(error)?;
    let needed = board["elements"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["type"] == "image")
        .filter_map(|item| item["fileId"].as_str().map(str::to_owned))
        .collect::<std::collections::BTreeSet<_>>();
    let mut files = board["files"].as_object().cloned().unwrap_or_default();
    for id in needed {
        if files.contains_key(&id) {
            continue;
        }
        match fs::read(image_path(root, &id)) {
            Ok(bytes) => {
                files.insert(id, serde_json::from_slice(&bytes).map_err(error)?);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(error(e)),
        }
    }
    board["files"] = Value::Object(files);
    serde_json::to_string(&board).map_err(error)
}

// Board names become file names, so keep them to plain characters. This also
// stops a name from reaching outside the whiteboards folder.
fn valid_board_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'))
}

// A board or folder is a path like "Physics/Cells/Board 2": each part must pass
// the name rule, so a path cannot reach outside the whiteboards folder.
fn valid_entry_path(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    parts.len() <= 6 && parts.iter().all(|part| valid_board_name(part))
}

fn whiteboards_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(tutor_dir(app)?.join("whiteboards"))
}

fn entry_file(app: &AppHandle, path: &str, folder: bool) -> Result<PathBuf> {
    if !valid_entry_path(path) {
        return Err("Names can use letters, numbers, spaces, - _ and . only.".into());
    }
    let base = whiteboards_dir(app)?;
    // The extension is added by hand, because a dot inside a name is allowed.
    Ok(if folder { base.join(path) } else { base.join(format!("{path}.excalidraw")) })
}

fn board_file(app: &AppHandle, name: &str) -> Result<PathBuf> {
    entry_file(app, name, false)
}

#[derive(Serialize)]
struct Entry {
    path: String,
    folder: bool,
}

fn walk(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<Entry>) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(error)? {
        let entry = entry.map_err(error)?;
        let kind = entry.file_type().map_err(error)?;
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            if valid_board_name(file_name) && depth < 5 {
                let name = format!("{prefix}{file_name}");
                out.push(Entry { path: name.clone(), folder: true });
                walk(&path, &format!("{name}/"), depth + 1, out)?;
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("excalidraw") {
            if let Some(stem) = path.file_stem().and_then(|n| n.to_str()) {
                if valid_board_name(stem) {
                    out.push(Entry { path: format!("{prefix}{stem}"), folder: false });
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn list_boards(app: AppHandle) -> Result<Vec<Entry>> {
    let mut out = Vec::new();
    match walk(&whiteboards_dir(&app)?, "", 0, &mut out) {
        Ok(()) => {}
        Err(_) if !whiteboards_dir(&app)?.exists() => {}
        Err(e) => return Err(e),
    }
    Ok(out)
}

#[tauri::command]
fn create_folder(app: AppHandle, path: String) -> Result<()> {
    let full = entry_file(&app, &path, true)?;
    fs::create_dir(full).map_err(error)
}

// Returns the board's text (or nothing for a new board) and records which board
// is open, so the terminal's tool can tell which file the student is looking at.
#[tauri::command]
fn open_board(app: AppHandle, name: String) -> Result<Option<String>> {
    let path = board_file(&app, &name)?;
    atomic(
        &tutor_dir(&app)?.join("current-board.txt"),
        format!("whiteboards/{name}.excalidraw\n").as_bytes(),
    )?;
    match fs::read_to_string(path) {
        Ok(board) => hydrate_board(&data_dir(&app)?, &board).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(error(e)),
    }
}

#[tauri::command]
fn rename_entry(app: AppHandle, old: String, new: String, folder: bool) -> Result<()> {
    let from = entry_file(&app, &old, folder)?;
    let to = entry_file(&app, &new, folder)?;
    // A change of letter case only is the same file on macOS, so allow it.
    if old.to_lowercase() != new.to_lowercase() && to.exists() {
        return Err(format!("\"{new}\" already exists."));
    }
    match fs::rename(&from, &to) {
        Ok(()) => {}
        // A board that was never saved has no file yet; there is nothing to move.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !folder => {}
        Err(e) => return Err(error(e)),
    }
    // Keep current-board.txt pointing at the open board.
    let marker = tutor_dir(&app)?.join("current-board.txt");
    if let Ok(text) = fs::read_to_string(&marker) {
        let open = text.trim_end().strip_prefix("whiteboards/").map(str::to_owned);
        if let Some(open) = open {
            let (old_part, new_part) = if folder {
                (format!("{old}/"), format!("{new}/"))
            } else {
                (format!("{old}.excalidraw"), format!("{new}.excalidraw"))
            };
            let moved = if folder {
                open.strip_prefix(&old_part).map(|rest| format!("{new_part}{rest}"))
            } else {
                (open == old_part).then_some(new_part)
            };
            if let Some(moved) = moved {
                atomic(&marker, format!("whiteboards/{moved}\n").as_bytes())?;
            }
        }
    }
    Ok(())
}

// Moves a board or a whole folder to the system Trash, so it can be put back.
#[tauri::command]
fn delete_entry(app: AppHandle, path: String, folder: bool) -> Result<()> {
    let full = entry_file(&app, &path, folder)?;
    if full.exists() {
        trash::delete(full).map_err(error)?;
    }
    Ok(())
}

#[tauri::command]
fn save_board_image(app: AppHandle, request: Request<'_>) -> Result<()> {
    let id = percent_decode(header(&request, "x-image-id")?)?;
    atomic(&image_path(&data_dir(&app)?, &id), binary(&request)?)
}

#[tauri::command]
fn save_board(app: AppHandle, request: Request<'_>) -> Result<()> {
    let name = percent_decode(header(&request, "x-board-name")?)?;
    atomic(&board_file(&app, &name)?, binary(&request)?)
}

#[tauri::command]
fn write_board_file(request: Request<'_>) -> Result<()> {
    let path = PathBuf::from(percent_decode(header(&request, "x-board-path")?)?);
    require_excalidraw(&path)?;
    atomic(&path, binary(&request)?)
}

fn percent_decode(value: &str) -> Result<String> {
    let mut result = Vec::new();
    let mut bytes = value.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let pair = [
                bytes.next().ok_or("Invalid path.")?,
                bytes.next().ok_or("Invalid path.")?,
            ];
            let hex = std::str::from_utf8(&pair).map_err(error)?;
            result.push(u8::from_str_radix(hex, 16).map_err(error)?);
        } else {
            result.push(byte);
        }
    }
    String::from_utf8(result).map_err(error)
}

fn require_excalidraw(path: &Path) -> Result<()> {
    if path.is_absolute()
        && path.extension().and_then(|suffix| suffix.to_str()) == Some("excalidraw")
    {
        return Ok(());
    }
    Err("Choose an absolute .excalidraw file path.".into())
}

const TUTOR_GUIDE: &str = "# Board Tutor

You are tutoring the student who uses the Board Tutor whiteboard app. This folder is your workspace.

- To see or mark the student's open board, use the board tools: `look_at_board` (add picture=true to read handwriting), `draw_on_board` and `erase_from_board`. Do not read or edit the .excalidraw files in `whiteboards/` directly; they are large and the app saves over them.
- `memory/` holds notes about the student: how they like to be taught (tone, pacing) and subject habits (for example, what to graph in math or draw in physics). Read it before teaching. When the student tells you a preference, add or update a note. Keep one topic per file.
- `skills/` holds teaching skills you can follow. Read the ones that fit the subject.

Do not delete files in these folders unless the student asks.
";

// The folder the app sets up in Documents. The terminal opens here, so tools
// like Claude Code ask about trusting it only once.
pub(crate) fn tutor_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().document_dir().map_err(error)?.join("boardtutor"))
}

fn ensure_tutor_dir(app: &AppHandle) -> Result<()> {
    let root = tutor_dir(app)?;
    for name in ["skills", "memory", "whiteboards"] {
        fs::create_dir_all(root.join(name)).map_err(error)?;
    }
    let guide = root.join("CLAUDE.md");
    if !guide.exists() {
        atomic(&guide, TUTOR_GUIDE.as_bytes())?;
    }
    Ok(())
}

fn main() {
    let builder = tauri::Builder::default();
    builder
        .setup(|app| {
            // A failure here shows up as an error the first time the board saves.
            let _ = ensure_tutor_dir(app.handle());
            if let Err(cause) = board_tools::start(app.handle()) {
                eprintln!("Board tools for Claude are off: {cause}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal::Session::default())
        .manage(board_tools::Pending::default())
        .invoke_handler(tauri::generate_handler![
            list_boards,
            open_board,
            create_folder,
            rename_entry,
            delete_entry,
            save_board,
            save_board_image,
            write_board_file,
            board_tools::board_tool_result,
            board_tools::encode_png,
            terminal::start_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::stop_terminal
        ])
        .run(tauri::generate_context!())
        .expect("Board Tutor could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_names_cannot_leave_the_whiteboards_folder() {
        assert!(valid_board_name("Board 2"));
        assert!(valid_board_name("physics - cells_v1.2"));
        assert!(valid_board_name("数学"));
        for bad in ["", ".hidden", "..", "../x", "a/b", "a\\b", "a:b"] {
            assert!(!valid_board_name(bad), "{bad:?}");
        }
        assert!(!valid_board_name(&"x".repeat(81)));
    }

    #[test]
    fn entry_paths_check_every_part() {
        assert!(valid_entry_path("Physics/Cells/Board 2"));
        for bad in ["a//b", "a/../b", "/a", "a/", "a/.hidden", "a/b/c/d/e/f/g"] {
            assert!(!valid_entry_path(bad), "{bad:?}");
        }
    }

    #[test]
    fn accepts_unicode_dialog_paths() {
        assert_eq!(
            percent_decode("/a%20b/%E6%95%B0%E5%AD%A6.excalidraw").unwrap(),
            "/a b/数学.excalidraw"
        );
        assert!(percent_decode("/invalid%Z0").is_err());
    }

    #[test]
    fn hydrates_separate_images_and_preserves_legacy_embedded_images() {
        let dir = tempfile::tempdir().unwrap();
        atomic(
            &image_path(dir.path(), "file:one"),
            br#"{"id":"file:one","dataURL":"data:disk"}"#,
        )
        .unwrap();
        let scene = r#"{"type":"excalidraw","elements":[{"type":"image","fileId":"file:one"},{"type":"image","fileId":"legacy"}],"files":{"legacy":{"id":"legacy","dataURL":"data:inline"}}}"#;
        let restored: Value =
            serde_json::from_str(&hydrate_board(dir.path(), scene).unwrap()).unwrap();
        assert_eq!(restored["files"]["file:one"]["dataURL"], "data:disk");
        assert_eq!(restored["files"]["legacy"]["dataURL"], "data:inline");
    }

    #[test]
    fn persistence_replaces_previous_save() {
        let dir = tempfile::tempdir().unwrap();
        let board = dir.path().join("board.excalidraw");
        atomic(&board, b"before").unwrap();
        atomic(&board, b"after").unwrap();
        assert_eq!(fs::read(board).unwrap(), b"after");
    }
}
