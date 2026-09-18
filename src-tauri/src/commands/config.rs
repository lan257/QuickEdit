use tauri::AppHandle;

use crate::error::CommandResult;
use crate::models::config::AppConfig;
use crate::services::storage::{config_path, read_json_or_default, write_json};

#[tauri::command]
pub fn load_config(app: AppHandle) -> CommandResult<AppConfig> {
    let path = config_path(&app)?;
    read_json_or_default(&path)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> CommandResult<()> {
    let path = config_path(&app)?;
    write_json(&path, &config)
}
