// Gives Claude Code two tools, "look_at_board" and "draw_on_board", through a
// small MCP server on this computer. Claude Code finds it through the
// .mcp.json file written into the boardtutor folder at launch. The board itself
// lives in the webview, so each tool call is passed to the page and answered there.
use crate::{atomic, binary, error, header, tutor_dir, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{ipc::Request, AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[derive(Default)]
pub struct Pending(Mutex<HashMap<String, mpsc::Sender<(String, Value)>>>);

fn tools() -> Value {
    json!([
        {
            "name": "look_at_board",
            "description": "List what is on the student's open whiteboard: each item's id, kind, text and position, plus the visible area. Set picture to true to also get an image (needed to read handwriting).",
            "inputSchema": {"type": "object", "properties": {"picture": {"type": "boolean"}}}
        },
        {
            "name": "draw_on_board",
            "description": "Add text and drawings to the student's open whiteboard. Coordinates are board coordinates, as given by look_at_board. Default color is red.",
            "inputSchema": {
                "type": "object",
                "properties": {"items": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"enum": ["text", "pencil", "arrow", "line", "rectangle", "ellipse", "diamond"]},
                        "x": {"type": "number"}, "y": {"type": "number"},
                        "width": {"type": "number"}, "height": {"type": "number"},
                        "text": {"type": "string"},
                        "size": {"type": "number", "description": "Font size, default 20"},
                        "points": {"type": "array", "items": {"type": "array", "items": {"type": "number"}},
                                   "description": "[[x,y],...] for pencil, arrow and line"},
                        "color": {"type": "string"}
                    },
                    "required": ["kind"]
                }}},
                "required": ["items"]
            }
        },
        {
            "name": "erase_from_board",
            "description": "Erase items from the student's open whiteboard by id (ids come from look_at_board or draw_on_board).",
            "inputSchema": {"type": "object", "properties": {"ids": {"type": "array", "items": {"type": "string"}}}, "required": ["ids"]}
        }
    ])
}

/// Starts the server on a free local port and writes .mcp.json for Claude Code.
pub fn start(app: &AppHandle) -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(error)?;
    let port = listener.local_addr().map_err(error)?.port();
    // Only Claude Code, which reads this token from .mcp.json, can call the tools.
    let token = Uuid::new_v4().to_string();
    let root = tutor_dir(app)?;
    let config = json!({"mcpServers": {"board": {
        "type": "http",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "headers": {"Authorization": format!("Bearer {token}")}
    }}});
    atomic(&root.join(".mcp.json"), serde_json::to_string_pretty(&config).map_err(error)?.as_bytes())?;
    // Approve this folder's board server and its tools once, so Claude does not ask each time.
    let settings = root.join(".claude").join("settings.json");
    if !settings.exists() {
        let allow = json!({"enableAllProjectMcpServers": true, "permissions": {"allow": ["mcp__board"]}});
        atomic(&settings, serde_json::to_string_pretty(&allow).map_err(error)?.as_bytes())?;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (app, token) = (app.clone(), token.clone());
            std::thread::spawn(move || {
                let _ = serve(stream, &app, &token);
            });
        }
    });
    Ok(())
}

fn serve(stream: TcpStream, app: &AppHandle, token: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let (mut length, mut auth, mut origin) = (0usize, String::new(), None::<String>);
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header == "\r\n" {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            let value = value.trim().to_owned();
            match name.to_ascii_lowercase().as_str() {
                "content-length" => length = value.parse().unwrap_or(0).min(1 << 20),
                "authorization" => auth = value,
                "origin" => origin = Some(value),
                _ => {}
            }
        }
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;

    let mut out = stream;
    let mut reply = |status: &str, body: &str| {
        write!(out, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    };
    if !line.starts_with("POST /mcp ") {
        return reply("405 Method Not Allowed", "");
    }
    // A web page cannot reach this server: browsers send Origin, Claude Code does not.
    if auth != format!("Bearer {token}") || origin.is_some() {
        return reply("403 Forbidden", "");
    }
    let Ok(request) = serde_json::from_slice::<Value>(&body) else {
        return reply("400 Bad Request", "");
    };
    let Some(id) = request.get("id").cloned() else {
        return reply("202 Accepted", ""); // a notification needs no answer
    };
    let params = &request["params"];
    let result = match request["method"].as_str().unwrap_or("") {
        "initialize" => Ok(json!({
            "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "board-tutor", "version": env!("CARGO_PKG_VERSION")}
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tools()})),
        "tools/call" => Ok(call_page(app, params)),
        other => Err(json!({"code": -32601, "message": format!("Unknown method {other}")})),
    };
    let message = match result {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err(error) => json!({"jsonrpc": "2.0", "id": id, "error": error}),
    };
    reply("200 OK", &message.to_string())
}

// Hands the call to the page, which owns the board, and waits for its answer.
fn call_page(app: &AppHandle, params: &Value) -> Value {
    let id = Uuid::new_v4().to_string();
    let (send, receive) = mpsc::channel();
    let pending = app.state::<Pending>();
    pending.0.lock().unwrap().insert(id.clone(), send);
    let asked = app.emit("board-tool", json!({"id": id, "name": params["name"], "args": params["arguments"]}));
    let answer = asked.ok().and_then(|_| receive.recv_timeout(Duration::from_secs(20)).ok());
    pending.0.lock().unwrap().remove(&id);
    match answer {
        Some((text, image)) => {
            let mut content = vec![json!({"type": "text", "text": text})];
            if let Some(data) = image.as_str() {
                content.push(json!({"type": "image", "data": data, "mimeType": "image/png"}));
            }
            json!({"content": content})
        }
        None => json!({"content": [{"type": "text", "text": "The Board Tutor app did not answer. Is a board open?"}], "isError": true}),
    }
}

#[tauri::command]
pub fn board_tool_result(pending: State<'_, Pending>, id: String, text: String, image: Option<String>) -> Result<()> {
    if let Some(send) = pending.0.lock().map_err(error)?.remove(&id) {
        let _ = send.send((text, image.map(Value::String).unwrap_or(Value::Null)));
    }
    Ok(())
}

// Turns raw RGBA pixels from the page into a base64 PNG (see picture() in boardTools.ts).
#[tauri::command]
pub fn encode_png(request: Request<'_>) -> Result<String> {
    let width: u32 = header(&request, "x-width")?.parse().map_err(error)?;
    let height: u32 = header(&request, "x-height")?.parse().map_err(error)?;
    let pixels = binary(&request)?;
    if width == 0 || height == 0 || width > 4096 || height > 4096 || pixels.len() as u64 != u64::from(width) * u64::from(height) * 4 {
        return Err("The board picture has the wrong size.".into());
    }
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().map_err(error)?.write_image_data(pixels).map_err(error)?;
    Ok(STANDARD.encode(out))
}
