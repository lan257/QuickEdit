use std::fs;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

use crate::error::{command_error, io_error, CommandResult};
use crate::models::annotation::AnnotationDocument;
use crate::models::file::{
    metadata_for_path, modified_time, path_from_string, validate_child_name, FileMetadata,
    TextDocument,
};
use crate::services::annotation_store::{annotation_path, refresh_annotation_document};
use crate::services::encoding::{decode_text, encode_text};
use crate::services::storage::{atomic_write, write_json};

static LAUNCH_PATHS: OnceLock<Vec<String>> = OnceLock::new();

pub fn collect_launch_paths() {
    let paths: Vec<String> = std::env::args().skip(1).filter(|item| !item.is_empty()).collect();
    let _ = LAUNCH_PATHS.set(paths);
}

#[tauri::command]
pub fn take_launch_paths() -> Vec<String> {
    LAUNCH_PATHS.get().cloned().unwrap_or_default()
}

#[tauri::command]
pub fn get_documents_directory(app: AppHandle) -> CommandResult<String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| command_error("APP_PATH_FAILED", error.to_string()))?
        .join("quickedit");
    fs::create_dir_all(&documents)
        .map_err(|error| io_error("CREATE_DOCUMENTS_DIR_FAILED", &documents, error))?;
    Ok(documents.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> CommandResult<FileMetadata> {
    let file_path = path_from_string(&path)?;
    metadata_for_path(&file_path)
}

#[tauri::command]
pub fn list_directory(path: String) -> CommandResult<Vec<FileMetadata>> {
    let directory = path_from_string(&path)?;
    let metadata =
        fs::metadata(&directory).map_err(|error| io_error("STAT_FAILED", &directory, error))?;
    if !metadata.is_dir() {
        return Err(command_error(
            "NOT_DIRECTORY",
            format!("不是目录: {}", directory.display()),
        ));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&directory)
        .map_err(|error| io_error("LIST_DIRECTORY_FAILED", &directory, error))?;
    for entry in read_dir {
        let entry =
            entry.map_err(|error| command_error("LIST_DIRECTORY_FAILED", error.to_string()))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.to_ascii_lowercase().ends_with(".qnote") {
            continue;
        }
        entries.push(metadata_for_path(&path)?);
    }

    entries.sort_by(|left, right| {
        left
            .is_directory
            .cmp(&right.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_text_file(app: AppHandle, path: String) -> CommandResult<TextDocument> {
    let file_path = path_from_string(&path)?;
    let metadata =
        fs::metadata(&file_path).map_err(|error| io_error("STAT_FAILED", &file_path, error))?;
    if metadata.is_dir() {
        return Err(command_error("NOT_FILE", "目录不能作为文本文件加载。"));
    }

    let config = crate::commands::config::load_config(app)?;
    let limit = config
        .editor
        .max_text_file_size_mb
        .max(1)
        .saturating_mul(1024 * 1024);
    if metadata.len() > limit {
        return Err(command_error(
            "TEXT_TOO_LARGE",
            format!(
                "文件大小 {} bytes，超过内置文本编辑器上限 {} MB。",
                metadata.len(),
                config.editor.max_text_file_size_mb.max(1)
            ),
        ));
    }

    let bytes =
        fs::read(&file_path).map_err(|error| io_error("READ_FILE_FAILED", &file_path, error))?;
    let (content, encoding) = decode_text(&bytes)?;
    Ok(TextDocument {
        path: file_path.to_string_lossy().into_owned(),
        content,
        encoding,
        size: metadata.len(),
        modified_time: modified_time(&metadata),
    })
}

#[tauri::command]
pub fn save_text_file(
    path: String,
    content: String,
    encoding: String,
    expected_size: u64,
    expected_modified_time: u64,
) -> CommandResult<FileMetadata> {
    let file_path = path_from_string(&path)?;
    let metadata =
        fs::metadata(&file_path).map_err(|error| io_error("STAT_FAILED", &file_path, error))?;
    if metadata.is_dir() {
        return Err(command_error("NOT_FILE", "目录不能保存为文本文件。"));
    }

    let current_modified_time = modified_time(&metadata);
    if metadata.len() != expected_size || current_modified_time != expected_modified_time {
        return Err(command_error(
            "EXTERNAL_MODIFICATION",
            "文件已被其他程序修改，请重新加载或确认后再保存。",
        ));
    }

    let bytes = encode_text(&content, &encoding);
    atomic_write(&file_path, &bytes)?;
    metadata_for_path(&file_path)
}

#[tauri::command]
pub fn read_binary_file(path: String) -> CommandResult<Vec<u8>> {
    let file_path = path_from_string(&path)?;
    let metadata = fs::metadata(&file_path)
        .map_err(|error| io_error("STAT_FAILED", &file_path, error))?;
    if metadata.is_dir() {
        return Err(command_error("NOT_FILE", "目录不能作为二进制文档加载。"));
    }
    fs::read(&file_path).map_err(|error| io_error("READ_FILE_FAILED", &file_path, error))
}

#[tauri::command]
pub fn save_binary_file(
    path: String,
    bytes: Vec<u8>,
    expected_size: u64,
    expected_modified_time: u64,
) -> CommandResult<FileMetadata> {
    let file_path = path_from_string(&path)?;
    let metadata = fs::metadata(&file_path)
        .map_err(|error| io_error("STAT_FAILED", &file_path, error))?;
    if metadata.is_dir() {
        return Err(command_error("NOT_FILE", "目录不能保存为二进制文档。"));
    }
    if metadata.len() != expected_size || modified_time(&metadata) != expected_modified_time {
        return Err(command_error(
            "EXTERNAL_MODIFICATION",
            "文件已被其他程序修改，请重新加载或确认后再保存。",
        ));
    }
    atomic_write(&file_path, &bytes)?;
    metadata_for_path(&file_path)
}

#[tauri::command]
pub fn create_folder(parent_path: String, name: String) -> CommandResult<FileMetadata> {
    let parent = path_from_string(&parent_path)?;
    let valid_name = validate_child_name(&name)?;
    let target = parent.join(valid_name);
    if target.exists() {
        return Err(command_error("ALREADY_EXISTS", "目标名称已存在。"));
    }
    fs::create_dir(&target).map_err(|error| io_error("CREATE_FOLDER_FAILED", &target, error))?;
    metadata_for_path(&target)
}

#[tauri::command]
pub fn create_document(
    parent_path: String,
    name: String,
    content: Option<String>,
) -> CommandResult<FileMetadata> {
    let parent = path_from_string(&parent_path)?;
    let valid_name = validate_child_name(&name)?;
    let target = parent.join(valid_name);
    if target.exists() {
        return Err(command_error("ALREADY_EXISTS", "目标名称已存在。"));
    }
    let bytes = content.unwrap_or_default();
    atomic_write(&target, bytes.as_bytes())?;
    metadata_for_path(&target)
}

#[tauri::command]
pub fn rename_document(
    app: AppHandle,
    path: String,
    new_name: String,
) -> CommandResult<FileMetadata> {
    let old_path = path_from_string(&path)?;
    let old_metadata = metadata_for_path(&old_path)?;
    let valid_name = validate_child_name(&new_name)?;
    let parent = old_path
        .parent()
        .ok_or_else(|| command_error("INVALID_PATH", "文件没有可用父目录。"))?;
    let new_path = parent.join(valid_name);
    if old_path
        .to_string_lossy()
        .eq_ignore_ascii_case(&new_path.to_string_lossy())
    {
        return Ok(old_metadata);
    }
    if new_path.exists() {
        return Err(command_error("RENAME_CONFLICT", "目标文件名已存在。"));
    }
    if old_metadata.is_directory {
        fs::rename(&old_path, &new_path)
            .map_err(|error| io_error("RENAME_FAILED", &old_path, error))?;
        return metadata_for_path(&new_path);
    }

    let old_note = annotation_path(&app, &old_path)?;
    let new_note = annotation_path(&app, &new_path)?;
    let has_note = old_note.exists();
    if has_note && new_note.exists() {
        return Err(command_error("RENAME_CONFLICT", "目标批注文件已存在。"));
    }

    let mut annotation = if has_note {
        let content = fs::read_to_string(&old_note)
            .map_err(|error| io_error("QNOTE_READ_FAILED", &old_note, error))?;
        Some(serde_json::from_str::<AnnotationDocument>(&content).map_err(|error| {
            command_error("QNOTE_INVALID", format!("批注文件格式无效: {error}"))
        })?)
    } else {
        None
    };

    fs::rename(&old_path, &new_path)
        .map_err(|error| io_error("RENAME_FAILED", &old_path, error))?;
    if has_note {
        if let Err(error) = fs::rename(&old_note, &new_note) {
            let rollback = fs::rename(&new_path, &old_path);
            if rollback.is_err() {
                return Err(command_error(
                    "RENAME_PARTIAL",
                    format!("批注改名失败且文件回滚失败: {error}"),
                ));
            }
            return Err(io_error("QNOTE_RENAME_FAILED", &old_note, error));
        }
    }

    let new_metadata = metadata_for_path(&new_path)?;
    if let Some(ref mut document) = annotation {
        refresh_annotation_document(document, &new_metadata);
        if let Err(error) = write_json(&new_note, document) {
            let note_rollback = fs::rename(&new_note, &old_note);
            let file_rollback = fs::rename(&new_path, &old_path);
            if note_rollback.is_err() || file_rollback.is_err() {
                return Err(command_error(
                    "RENAME_PARTIAL",
                    format!("批注更新失败且事务回滚失败: {}", error.message),
                ));
            }
            return Err(command_error(
                "RENAME_ROLLBACK",
                format!("批注更新失败，已回滚重命名: {}", error.message),
            ));
        }
    }
    Ok(new_metadata)
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> CommandResult<()> {
    let target = path_from_string(&path)?;
    if !target.exists() {
        return Err(command_error("STAT_FAILED", "目标路径不存在。"));
    }
    #[cfg(windows)]
    {
        use std::process::Command;
        let target_text = target.to_string_lossy().into_owned();
        let mut command = Command::new("explorer.exe");
        if target.is_dir() {
            command.arg(target_text);
        } else {
            command.arg(format!("/select,{}", target_text));
        }
        command
            .spawn()
            .map_err(|error| command_error("EXPLORER_LAUNCH_FAILED", error.to_string()))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err(command_error("UNSUPPORTED_PLATFORM", "仅 Windows 支持资源管理器定位。"))
    }
}
