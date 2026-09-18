use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::error::{command_error, io_error, CommandResult};
use crate::models::annotation::{now_iso8601, AnnotationDocument, AnnotationState};
use crate::models::file::{metadata_for_path, path_from_string};
use crate::services::annotation_store::{
    annotation_path, annotation_target, annotation_target_is_stale, refresh_annotation_document,
};
use crate::services::storage::write_json;

#[tauri::command]
pub fn load_annotations(app: AppHandle, target_path: String) -> CommandResult<AnnotationState> {
    let target = path_from_string(&target_path)?;
    let metadata = metadata_for_path(&target)?;
    if metadata.is_directory {
        return Err(command_error("NOT_FILE", "目录不能关联批注。"));
    }
    let note_path = annotation_path(&app, &target)?;
    let exists = note_path.exists();
    let mut document = if exists {
        let content = fs::read_to_string(&note_path)
            .map_err(|error| io_error("QNOTE_READ_FAILED", &note_path, error))?;
        serde_json::from_str::<AnnotationDocument>(&content).map_err(|error| {
            command_error(
                "QNOTE_INVALID",
                format!("批注文件格式无效: {}: {error}", note_path.display()),
            )
        })?
    } else {
        AnnotationDocument::default()
    };
    let stale = exists && annotation_target_is_stale(&document.target, &metadata);
    document.target = annotation_target(&metadata);
    if document.updated_at.is_empty() {
        document.updated_at = now_iso8601();
    }
    Ok(AnnotationState {
        path: note_path.to_string_lossy().into_owned(),
        exists,
        stale,
        document,
    })
}

#[tauri::command]
pub fn recover_annotations(app: AppHandle, target_path: String) -> CommandResult<AnnotationState> {
    let target = path_from_string(&target_path)?;
    let metadata = metadata_for_path(&target)?;
    if metadata.is_directory {
        return Err(command_error("NOT_FILE", "目录不能关联批注。"));
    }
    let note_path = annotation_path(&app, &target)?;
    if note_path.exists() {
        let stamp = now_iso8601().replace([':', 'T', 'Z'], "-");
        let backup_path = PathBuf::from(format!("{}.invalid-{}.bak", note_path.display(), stamp));
        fs::rename(&note_path, &backup_path)
            .map_err(|error| io_error("QNOTE_BACKUP_FAILED", &note_path, error))?;
    }
    let mut document = AnnotationDocument::default();
    refresh_annotation_document(&mut document, &metadata);
    write_json(&note_path, &document)?;
    Ok(AnnotationState {
        path: note_path.to_string_lossy().into_owned(),
        exists: true,
        stale: false,
        document,
    })
}

#[tauri::command]
pub fn save_annotations(
    app: AppHandle,
    target_path: String,
    mut document: AnnotationDocument,
) -> CommandResult<AnnotationState> {
    let target = path_from_string(&target_path)?;
    let metadata = metadata_for_path(&target)?;
    if metadata.is_directory {
        return Err(command_error("NOT_FILE", "目录不能关联批注。"));
    }
    let note_path = annotation_path(&app, &target)?;
    refresh_annotation_document(&mut document, &metadata);
    write_json(&note_path, &document)?;
    Ok(AnnotationState {
        path: note_path.to_string_lossy().into_owned(),
        exists: true,
        stale: false,
        document,
    })
}
