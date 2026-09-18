use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::commands::config::load_config;
use crate::error::{command_error, CommandResult};
use crate::models::annotation::{
    now_iso8601, AnnotationDocument, AnnotationTarget,
};
use crate::models::file::FileMetadata;

pub fn annotation_path(app: &AppHandle, target_path: &Path) -> CommandResult<PathBuf> {
    let config = load_config(app.clone())?;
    let extension = config.annotations.extension.trim();
    if extension.is_empty() {
        return Err(command_error("INVALID_CONFIG", "批注扩展名不能为空。"));
    }
    let extension = if extension.starts_with('.') {
        extension.to_string()
    } else {
        format!(".{extension}")
    };
    Ok(PathBuf::from(format!("{}{}", target_path.to_string_lossy(), extension)))
}

pub fn annotation_target(metadata: &FileMetadata) -> AnnotationTarget {
    AnnotationTarget {
        name: metadata.name.clone(),
        size: metadata.size,
        modified_time: metadata.modified_time,
    }
}

pub fn annotation_target_is_stale(target: &AnnotationTarget, metadata: &FileMetadata) -> bool {
    if target.name.is_empty() || (target.size == 0 && target.modified_time == 0) {
        return false;
    }
    target.name != metadata.name
        || target.size != metadata.size
        || target.modified_time != metadata.modified_time
}

pub fn refresh_annotation_document(document: &mut AnnotationDocument, metadata: &FileMetadata) {
    let now = now_iso8601();
    document.target = annotation_target(metadata);
    document.updated_at = now.clone();
    for annotation in &mut document.annotations {
        if annotation.created_at.is_empty() {
            annotation.created_at = now.clone();
        }
        if annotation.updated_at.is_empty() {
            annotation.updated_at = now.clone();
        }
    }
}
