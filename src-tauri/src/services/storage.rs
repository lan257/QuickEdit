use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::error::{command_error, io_error, CommandResult};
use crate::models::config::{CONFIG_FILE, WORKSPACE_FILE};

pub fn config_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| command_error("APP_PATH_FAILED", error.to_string()))?;
    fs::create_dir_all(&directory)
        .map_err(|error| io_error("CREATE_CONFIG_DIR_FAILED", &directory, error))?;
    Ok(directory.join(CONFIG_FILE))
}

pub fn workspace_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| command_error("APP_PATH_FAILED", error.to_string()))?;
    fs::create_dir_all(&directory)
        .map_err(|error| io_error("CREATE_CONFIG_DIR_FAILED", &directory, error))?;
    Ok(directory.join(WORKSPACE_FILE))
}

#[cfg(windows)]
fn replace_file(temp_path: &Path, target_path: &Path) -> CommandResult<()> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temp_wide: Vec<u16> = temp_path.as_os_str().encode_wide().chain(once(0)).collect();
    let target_wide: Vec<u16> = target_path
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            temp_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(command_error(
            "REPLACE_TARGET_FAILED",
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(temp_path: &Path, target_path: &Path) -> CommandResult<()> {
    fs::rename(temp_path, target_path)
        .map_err(|error| command_error("REPLACE_TARGET_FAILED", error.to_string()))
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> CommandResult<()> {
    let parent = path.parent().ok_or_else(|| {
        command_error(
            "INVALID_TARGET",
            format!("目标没有可用父目录: {}", path.display()),
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| io_error("CREATE_PARENT_FAILED", parent, error))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temp_name = format!(
        ".{}.quickedit-{}-{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file"),
        std::process::id(),
        stamp
    );
    let temp_path = parent.join(temp_name);

    if let Err(error) = fs::write(&temp_path, bytes) {
        return Err(io_error("WRITE_TEMP_FAILED", &temp_path, error));
    }

    let replace_result = replace_file(&temp_path, path);
    if replace_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    replace_result
}

pub fn read_json_or_default<T>(path: &Path) -> CommandResult<T>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    let content =
        fs::read_to_string(path).map_err(|error| io_error("READ_JSON_FAILED", path, error))?;
    serde_json::from_str(&content)
        .map_err(|error| command_error("INVALID_JSON", format!("{}: {error}", path.display())))
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> CommandResult<()> {
    let content = serde_json::to_vec_pretty(value)
        .map_err(|error| command_error("SERIALIZE_FAILED", error.to_string()))?;
    atomic_write(path, &content)
}
