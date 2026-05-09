mod pty;

use pty::AgentManager;
use tauri::{AppHandle, State};

#[tauri::command]
fn spawn_agent(
    app: AppHandle,
    manager: State<'_, AgentManager>,
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    manager
        .spawn(app, id, command, args, cwd, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn write_agent(
    manager: State<'_, AgentManager>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    manager.write(&id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_agent(
    manager: State<'_, AgentManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
fn kill_agent(manager: State<'_, AgentManager>, id: String) -> Result<(), String> {
    manager.kill(&id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentManager::new())
        .invoke_handler(tauri::generate_handler![
            spawn_agent,
            write_agent,
            resize_agent,
            kill_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
