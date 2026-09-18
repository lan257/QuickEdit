use tauri::AppHandle;

use crate::error::CommandResult;
use crate::models::config::WorkspaceState;
use crate::services::storage::{read_json_or_default, workspace_path, write_json};

#[tauri::command]
pub fn load_workspace(app: AppHandle) -> CommandResult<WorkspaceState> {
    let path = workspace_path(&app)?;
    read_json_or_default(&path)
}

#[tauri::command]
pub fn save_workspace(app: AppHandle, state: WorkspaceState) -> CommandResult<()> {
    let path = workspace_path(&app)?;
    write_json(&path, &state)
}
