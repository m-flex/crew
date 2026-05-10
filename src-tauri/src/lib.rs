mod git;
mod pty;

use git::{
    BranchList, CommitInfo, CommitResult, DetectInfo, DiffResult, GitManager,
    GitStatus, WorktreeCreated,
};
use pty::AgentManager;
use tauri::{AppHandle, Manager, State};

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

#[tauri::command]
fn git_detect(
    manager: State<'_, GitManager>,
    path: String,
) -> Result<Option<DetectInfo>, String> {
    manager.detect(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_status(manager: State<'_, GitManager>, cwd: String) -> Result<GitStatus, String> {
    manager.status(&cwd).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_list_branches(
    manager: State<'_, GitManager>,
    cwd: String,
) -> Result<BranchList, String> {
    manager.list_branches(&cwd).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_create_worktree(
    manager: State<'_, GitManager>,
    repo_root: String,
    branch: String,
    base: Option<String>,
    new_branch: bool,
    pane_id: String,
) -> Result<WorktreeCreated, String> {
    manager
        .create_worktree(&repo_root, &branch, base.as_deref(), new_branch, &pane_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_remove_worktree(
    manager: State<'_, GitManager>,
    pane_id: String,
    force: bool,
) -> Result<bool, String> {
    manager
        .remove_worktree(&pane_id, force)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_forget_worktree(
    manager: State<'_, GitManager>,
    pane_id: String,
) -> Result<(), String> {
    manager.forget_worktree(&pane_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_checkout(
    manager: State<'_, GitManager>,
    cwd: String,
    branch: String,
    create: bool,
) -> Result<(), String> {
    manager
        .checkout(&cwd, &branch, create)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_delete_branch(
    manager: State<'_, GitManager>,
    cwd: String,
    branch: String,
) -> Result<(), String> {
    manager
        .delete_branch(&cwd, &branch)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_stage(
    manager: State<'_, GitManager>,
    cwd: String,
    paths: Vec<String>,
) -> Result<(), String> {
    manager.stage(&cwd, paths).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_unstage(
    manager: State<'_, GitManager>,
    cwd: String,
    paths: Vec<String>,
) -> Result<(), String> {
    manager.unstage(&cwd, paths).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_discard(
    manager: State<'_, GitManager>,
    cwd: String,
    paths: Vec<String>,
) -> Result<(), String> {
    manager.discard(&cwd, paths).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_diff(
    manager: State<'_, GitManager>,
    cwd: String,
    path: Option<String>,
    staged: bool,
) -> Result<DiffResult, String> {
    manager
        .diff(&cwd, path.as_deref(), staged)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_commit(
    manager: State<'_, GitManager>,
    cwd: String,
    message: String,
    amend: bool,
) -> Result<CommitResult, String> {
    manager
        .commit(&cwd, &message, amend)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_log(
    manager: State<'_, GitManager>,
    cwd: String,
    limit: usize,
    branch: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    manager
        .log(&cwd, limit, branch.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_pull(
    manager: State<'_, GitManager>,
    cwd: String,
) -> Result<String, String> {
    manager.pull(&cwd).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AgentManager::new())
        .manage(GitManager::new())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                let manager: State<GitManager> = app.state();
                manager.init_state_dir(dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spawn_agent,
            write_agent,
            resize_agent,
            kill_agent,
            git_detect,
            git_status,
            git_list_branches,
            git_create_worktree,
            git_remove_worktree,
            git_forget_worktree,
            git_checkout,
            git_delete_branch,
            git_stage,
            git_unstage,
            git_discard,
            git_diff,
            git_commit,
            git_log,
            git_pull
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
