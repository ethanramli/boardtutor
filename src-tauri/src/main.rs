#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod recording;
mod terminal;

use serde_json::{json, Value};
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

#[tauri::command]
fn load_board(app: AppHandle) -> Result<Option<String>> {
    let root = data_dir(&app)?;
    match fs::read_to_string(root.join("workspace.excalidraw")) {
        Ok(board) => hydrate_board(&root, &board).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(error(e)),
    }
}

#[tauri::command]
fn save_board_image(app: AppHandle, request: Request<'_>) -> Result<()> {
    let id = percent_decode(header(&request, "x-image-id")?)?;
    atomic(&image_path(&data_dir(&app)?, &id), binary(&request)?)
}

#[tauri::command]
fn save_board(app: AppHandle, request: Request<'_>) -> Result<()> {
    atomic(
        &data_dir(&app)?.join("workspace.excalidraw"),
        binary(&request)?,
    )
}

#[tauri::command]
fn read_board_file(path: PathBuf) -> Result<String> {
    require_excalidraw(&path)?;
    fs::read_to_string(path).map_err(error)
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

#[tauri::command]
fn prepare_ask(app: AppHandle, request: Request<'_>) -> Result<Value> {
    let root = data_dir(&app)?;
    let id = Uuid::new_v4().to_string();
    let dir = root.join("tutor").join(&id);
    let board: Value = serde_json::from_slice(binary(&request)?).map_err(error)?;
    let scene = board
        .get("scene")
        .and_then(Value::as_str)
        .ok_or("Missing board scene.")?;
    atomic(&dir.join("board.excalidraw"), scene.as_bytes())?;
    for (field, name) in [("image", "board.png"), ("focus", "circled.png")] {
        if let Some(image) = board.get(field).and_then(Value::as_str) {
            use base64::Engine;
            let png = image
                .strip_prefix("data:image/png;base64,")
                .ok_or("Invalid board image.")?;
            atomic(
                &dir.join(name),
                &base64::engine::general_purpose::STANDARD
                    .decode(png)
                    .map_err(error)?,
            )?;
        }
    }
    if let Some(recording) = board.get("recording").and_then(Value::as_str) {
        let source = recording::recording_dir(&app, recording)?;
        for file in ["recording.mp4", "transcript.txt"] {
            fs::hard_link(source.join(file), dir.join(file))
                .or_else(|_| fs::copy(source.join(file), dir.join(file)).map(|_| ()))
                .map_err(error)?;
        }
        let frames = source.join("frames");
        if frames.is_dir() {
            fs::create_dir(dir.join("frames")).map_err(error)?;
            for entry in fs::read_dir(frames).map_err(error)? {
                let entry = entry.map_err(error)?;
                let target = dir.join("frames").join(entry.file_name());
                fs::hard_link(entry.path(), &target)
                    .or_else(|_| fs::copy(entry.path(), &target).map(|_| ()))
                    .map_err(error)?;
            }
        }
    }
    Ok(json!({"id": id, "path": dir}))
}

#[tauri::command]
fn board_annotation(app: AppHandle, id: String) -> Result<Option<String>> {
    valid_id(&id)?;
    let path = data_dir(&app)?
        .join("tutor")
        .join(id)
        .join("annotation.excalidraw");
    match fs::read_to_string(path) {
        Ok(scene) => Ok(Some(scene)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(error(e)),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(recording::Captures::default())
        .manage(terminal::Session::default())
        .invoke_handler(tauri::generate_handler![
            load_board,
            save_board,
            save_board_image,
            read_board_file,
            write_board_file,
            prepare_ask,
            board_annotation,
            recording::check_tools,
            recording::start_recording,
            recording::append_recording,
            recording::finish_recording,
            recording::cancel_recording,
            recording::transcribe,
            recording::latest_recording,
            terminal::start_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::stop_terminal
        ])
        .run(tauri::generate_context!())
        .expect("Excali Tutor could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

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
