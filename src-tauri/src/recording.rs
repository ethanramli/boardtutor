use crate::{atomic, binary, data_dir, error, header, valid_id, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::Mutex,
};
use tauri::{ipc::Request, AppHandle, State};
use uuid::Uuid;

struct Capture {
    file: File,
    source: PathBuf,
}

#[derive(Default)]
pub struct Captures(Mutex<HashMap<String, Capture>>);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    start_ms: u64,
    end_ms: u64,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replay {
    id: String,
    video_path: PathBuf,
    lines: Option<Vec<Line>>,
}

pub fn recording_dir(app: &AppHandle, id: &str) -> Result<PathBuf> {
    valid_id(id)?;
    Ok(data_dir(app)?.join("recordings").join(id))
}

fn executable(name: &str) -> PathBuf {
    let candidates = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .chain(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    for dir in candidates {
        let candidate = dir.join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_owned()
        });
        if candidate.is_file() {
            return candidate;
        }
    }
    name.into()
}

fn run(program: &str, args: &[&std::ffi::OsStr]) -> Result<Output> {
    let mut command = Command::new(executable(program));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command
        .args(args)
        .output()
        .map_err(|e| format!("Could not run {program}. See the setup instructions. {e}"))?;
    if output.status.success() {
        return Ok(output);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail = stderr.lines().rev().take(6).collect::<Vec<_>>();
    Err(format!(
        "{program} failed: {}",
        tail.into_iter().rev().collect::<Vec<_>>().join("\n")
    ))
}

fn model(app: &AppHandle) -> Result<PathBuf> {
    let path = std::env::var_os("EXCALI_TUTOR_MODEL")
        .map(PathBuf::from)
        .unwrap_or(data_dir(app)?.join("models").join("ggml-base.en.bin"));
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!(
            "Offline English model missing at {}. Run the model setup instructions.",
            path.display()
        ))
    }
}

#[tauri::command]
pub async fn check_tools(app: AppHandle) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        run("ffmpeg", &["-version".as_ref()])?;
        run("whisper-cli", &["--help".as_ref()])?;
        model(&app)?;
        Ok(())
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    captures: State<'_, Captures>,
    format: String,
) -> Result<String> {
    if !matches!(format.as_str(), "mp4" | "webm") {
        return Err("Unsupported recording format.".into());
    }
    let id = Uuid::new_v4().to_string();
    let dir = recording_dir(&app, &id)?;
    fs::create_dir_all(&dir).map_err(error)?;
    let source = dir.join(format!("source.{format}"));
    let file = File::create(&source).map_err(error)?;
    captures
        .0
        .lock()
        .map_err(error)?
        .insert(id.clone(), Capture { file, source });
    Ok(id)
}

#[tauri::command]
pub fn append_recording(captures: State<'_, Captures>, request: Request<'_>) -> Result<()> {
    let id = header(&request, "x-recording-id")?;
    let mut open = captures.0.lock().map_err(error)?;
    let capture = open.get_mut(id).ok_or("Recording is no longer open.")?;
    capture.file.write_all(binary(&request)?).map_err(error)
}

#[tauri::command]
pub fn cancel_recording(app: AppHandle, captures: State<'_, Captures>, id: String) -> Result<()> {
    let capture = captures.0.lock().map_err(error)?.remove(&id);
    if capture.is_some() {
        drop(capture);
        fs::remove_dir_all(recording_dir(&app, &id)?).map_err(error)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn finish_recording(
    app: AppHandle,
    captures: State<'_, Captures>,
    id: String,
) -> Result<Replay> {
    let Capture { file, source } = captures
        .0
        .lock()
        .map_err(error)?
        .remove(&id)
        .ok_or("Recording is no longer open.")?;
    drop(file);
    tauri::async_runtime::spawn_blocking(move || {
        let dir = recording_dir(&app, &id)?;
        let video = dir.join("recording.mp4");
        run(
            "ffmpeg",
            &[
                "-nostdin".as_ref(),
                "-loglevel".as_ref(),
                "error".as_ref(),
                "-y".as_ref(),
                "-i".as_ref(),
                source.as_os_str(),
                "-map".as_ref(),
                "0:v:0".as_ref(),
                "-map".as_ref(),
                "0:a:0".as_ref(),
                "-vf".as_ref(),
                "scale=trunc(iw/2)*2:trunc(ih/2)*2".as_ref(),
                "-af".as_ref(),
                "aresample=async=1:first_pts=0".as_ref(),
                "-c:v".as_ref(),
                "libx264".as_ref(),
                "-preset".as_ref(),
                "veryfast".as_ref(),
                "-pix_fmt".as_ref(),
                "yuv420p".as_ref(),
                "-c:a".as_ref(),
                "aac".as_ref(),
                "-movflags".as_ref(),
                "+faststart".as_ref(),
                video.as_os_str(),
            ],
        )
        .map_err(|message| format!("{message}\nOriginal capture is at {}", source.display()))?;
        atomic(&data_dir(&app)?.join("latest-recording"), id.as_bytes())?;
        let _ = fs::remove_file(source);
        replay(&app, id)
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub fn latest_recording(app: AppHandle) -> Result<Option<Replay>> {
    match fs::read_to_string(data_dir(&app)?.join("latest-recording")) {
        Ok(id) => replay(&app, id).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(error(e)),
    }
}

fn replay(app: &AppHandle, id: String) -> Result<Replay> {
    let dir = recording_dir(app, &id)?;
    let lines = match fs::read(dir.join("transcript.json")) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).map_err(error)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(error(e)),
    };
    Ok(Replay {
        id,
        video_path: dir.join("recording.mp4"),
        lines,
    })
}

#[derive(Deserialize)]
struct WhisperOutput {
    transcription: Vec<WhisperLine>,
}

#[derive(Deserialize)]
struct WhisperLine {
    offsets: Offsets,
    text: String,
}

#[derive(Deserialize)]
struct Offsets {
    from: u64,
    to: u64,
}

fn format_time(ms: u64) -> String {
    let seconds = ms / 1000;
    format!(
        "{:02}:{:02}:{:02}.{:03}",
        seconds / 3600,
        (seconds / 60) % 60,
        seconds % 60,
        ms % 1000
    )
}

fn write_transcript(dir: &Path, bytes: &[u8]) -> Result<()> {
    let result: WhisperOutput = serde_json::from_slice(bytes).map_err(error)?;
    let lines = result
        .transcription
        .into_iter()
        .filter_map(|line| {
            let text = line.text.trim();
            (!text.is_empty()).then(|| Line {
                start_ms: line.offsets.from,
                end_ms: line.offsets.to,
                text: text.to_owned(),
            })
        })
        .collect::<Vec<_>>();
    let transcript = lines
        .iter()
        .map(|line| {
            format!(
                "[{} to {}] {}\n",
                format_time(line.start_ms),
                format_time(line.end_ms),
                line.text
            )
        })
        .collect::<String>();
    atomic(&dir.join("transcript.txt"), transcript.as_bytes())?;
    atomic(
        &dir.join("transcript.json"),
        &serde_json::to_vec(&lines).map_err(error)?,
    )
}

#[tauri::command]
pub async fn transcribe(app: AppHandle, id: String) -> Result<Replay> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = recording_dir(&app, &id)?;
        let video = dir.join("recording.mp4");
        let model = model(&app)?;
        let work = tempfile::tempdir_in(&dir).map_err(error)?;
        let audio = work.path().join("speech.wav");
        let output = work.path().join("whisper");
        run(
            "ffmpeg",
            &[
                "-nostdin".as_ref(),
                "-loglevel".as_ref(),
                "error".as_ref(),
                "-i".as_ref(),
                video.as_os_str(),
                "-vn".as_ref(),
                "-ar".as_ref(),
                "16000".as_ref(),
                "-ac".as_ref(),
                "1".as_ref(),
                "-c:a".as_ref(),
                "pcm_s16le".as_ref(),
                audio.as_os_str(),
            ],
        )?;
        run(
            "whisper-cli",
            &[
                "-m".as_ref(),
                model.as_os_str(),
                "-f".as_ref(),
                audio.as_os_str(),
                "-l".as_ref(),
                "en".as_ref(),
                "-oj".as_ref(),
                "-of".as_ref(),
                output.as_os_str(),
            ],
        )?;
        // The video remains the source of truth. JPEGs help CLIs that take images.
        let frames = dir.join("frames");
        fs::create_dir_all(&frames).map_err(error)?;
        let pattern = frames.join("frame-%05d.jpg");
        if let Err(message) = run(
            "ffmpeg",
            &[
                "-nostdin".as_ref(),
                "-loglevel".as_ref(),
                "error".as_ref(),
                "-y".as_ref(),
                "-i".as_ref(),
                video.as_os_str(),
                "-an".as_ref(),
                "-vf".as_ref(),
                "fps=1/5:start_time=0,scale='min(1280,iw)':-2".as_ref(),
                "-frames:v".as_ref(),
                "120".as_ref(),
                "-start_number".as_ref(),
                "0".as_ref(),
                pattern.as_os_str(),
            ],
        ) {
            eprintln!("Could not generate tutor preview frames: {message}");
        }
        write_transcript(
            &dir,
            &fs::read(output.with_extension("json")).map_err(error)?,
        )?;
        replay(&app, id)
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_millisecond_offsets_in_both_formats() {
        let dir = tempfile::tempdir().unwrap();
        write_transcript(
            dir.path(),
            br#"{"transcription":[
            {"offsets":{"from":1250,"to":3420},"text":"  Both masses move together.  "},
            {"offsets":{"from":3500,"to":4000},"text":" "}
        ]}"#,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("transcript.txt")).unwrap(),
            "[00:00:01.250 to 00:00:03.420] Both masses move together.\n"
        );
        let lines: Vec<Line> =
            serde_json::from_slice(&fs::read(dir.path().join("transcript.json")).unwrap()).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].start_ms, 1250);
    }
}
