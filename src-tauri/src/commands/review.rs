use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use serde::Serialize;

use crate::error::{command_error, io_error, CommandResult};
use crate::models::review::{ChangeSet, ChangeSetStatus};
use crate::services::review_store;

fn reviews_root(app: &AppHandle) -> CommandResult<PathBuf> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| command_error("APP_PATH_FAILED", error.to_string()))?;
    let root = directory.join("reviews");
    fs::create_dir_all(&root).map_err(|error| io_error("CREATE_DIR_FAILED", &root, error))?;
    Ok(root)
}

/// 开始记录一轮 Agent 修改：立刻为给定文件保存基线。
#[tauri::command]
pub fn review_begin(
    app: AppHandle,
    paths: Vec<String>,
    source: Option<String>,
    summary: Option<String>,
) -> CommandResult<ChangeSet> {
    review_store::begin(
        &reviews_root(&app)?,
        source.as_deref().unwrap_or("agent"),
        summary,
        paths,
    )
}

#[tauri::command]
pub fn review_track(app: AppHandle, id: String, paths: Vec<String>) -> CommandResult<ChangeSet> {
    review_store::track(&reviews_root(&app)?, &id, paths)
}

/// 采集本轮改动，进入待审批。
#[tauri::command]
pub fn review_capture(app: AppHandle, id: String) -> CommandResult<ChangeSet> {
    review_store::capture(&reviews_root(&app)?, &id)
}

#[tauri::command]
pub fn review_get(app: AppHandle, id: String) -> CommandResult<ChangeSet> {
    review_store::read_changeset(&reviews_root(&app)?, &id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDiff {
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

#[tauri::command]
pub fn review_diff(app: AppHandle, id: String, path: String) -> CommandResult<ReviewDiff> {
    let (before, after) = review_store::diff_texts(&reviews_root(&app)?, &id, &path)?;
    Ok(ReviewDiff { path, before, after })
}

/// UI 轮询用：待审批与仍在记录的轮次。
#[tauri::command]
pub fn review_pending(app: AppHandle) -> CommandResult<Vec<ChangeSet>> {
    Ok(review_store::list_changesets(&reviews_root(&app)?)
        .into_iter()
        .filter(|set| matches!(set.status, ChangeSetStatus::Pending | ChangeSetStatus::Recording))
        .collect())
}

#[tauri::command]
pub fn review_history(app: AppHandle, limit: Option<usize>) -> CommandResult<Vec<ChangeSet>> {
    let take = limit.unwrap_or(50).clamp(1, 200);
    Ok(review_store::list_changesets(&reviews_root(&app)?)
        .into_iter()
        .take(take)
        .collect())
}

#[tauri::command]
pub fn review_approve(app: AppHandle, id: String) -> CommandResult<ChangeSet> {
    review_store::approve(&reviews_root(&app)?, &id)
}

/// 回滚本轮修改；原因会被记录，供 Agent 下一轮读取。
#[tauri::command]
pub fn review_reject(
    app: AppHandle,
    id: String,
    reason: Option<String>,
) -> CommandResult<ChangeSet> {
    review_store::reject(&reviews_root(&app)?, &id, reason)
}
