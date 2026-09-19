use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{command_error, io_error, CommandResult};
use crate::models::file::path_from_string;
use crate::models::review::{
    ChangeDecision, ChangeSet, ChangeSetStatus, FileChange, FileChangeKind,
};

/// 审批记录最多保留多少条已决结果（设计文档 §15.6）。
pub const AUDIT_KEEP: usize = 100;
/// 超过该大小不再尝试按文本 diff。
const TEXT_LIMIT: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineRecord {
    pub path: String,
    /// 基线内容落盘位置；文件当时不存在则为 None（回滚时按删除处理）。
    pub slot: Option<usize>,
    pub existed: bool,
    pub size: u64,
    pub modified_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub id: String,
    pub records: Vec<BaselineRecord>,
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

pub fn new_change_set_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.subsec_nanos())
        .unwrap_or_default();
    format!("cs-{}-{:08x}", timestamp(), nanos)
}

fn audit_dir(root: &Path) -> PathBuf {
    root.join("audit")
}

fn changeset_path(root: &Path, id: &str) -> PathBuf {
    audit_dir(root).join(format!("{id}.json"))
}

fn rollback_dir(root: &Path, id: &str) -> PathBuf {
    root.join("rollback").join(id)
}

fn baseline_path(root: &Path, id: &str) -> PathBuf {
    rollback_dir(root, id).join("manifest.json")
}

fn blob_path(root: &Path, id: &str, slot: usize) -> PathBuf {
    rollback_dir(root, id).join(format!("blob-{slot}"))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| io_error("CREATE_DIR_FAILED", parent, error))?;
    }
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| command_error("SERIALIZE_FAILED", error.to_string()))?;
    fs::write(path, text).map_err(|error| io_error("WRITE_FAILED", path, error))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> CommandResult<T> {
    let text = fs::read_to_string(path).map_err(|error| io_error("READ_FAILED", path, error))?;
    serde_json::from_str(&text).map_err(|error| command_error("DESERIALIZE_FAILED", error.to_string()))
}

pub fn read_changeset(root: &Path, id: &str) -> CommandResult<ChangeSet> {
    let path = changeset_path(root, id);
    if !path.exists() {
        return Err(command_error("CHANGESET_NOT_FOUND", format!("没有找到修改轮次 {id}。")));
    }
    read_json(&path)
}

/// 最近若干条，已决的旧记录按时间淘汰；未决的始终保留。
pub fn list_changesets(root: &Path) -> Vec<ChangeSet> {
    let directory = audit_dir(root);
    let Ok(entries) = fs::read_dir(&directory) else {
        return Vec::new();
    };
    let mut sets: Vec<ChangeSet> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            read_json::<ChangeSet>(&path).ok()
        })
        .collect();
    sets.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    sets
}

pub fn prune_audit(root: &Path) -> CommandResult<()> {
    let directory = audit_dir(root);
    let Ok(entries) = fs::read_dir(&directory) else {
        return Ok(());
    };
    let mut decided: Vec<(u64, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            let set = read_json::<ChangeSet>(&path).ok()?;
            match set.status {
                ChangeSetStatus::Approved | ChangeSetStatus::Rejected => Some((set.created_at, path)),
                _ => None,
            }
        })
        .collect();
    decided.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in decided.iter().skip(AUDIT_KEEP) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn read_baseline(root: &Path, id: &str) -> CommandResult<Baseline> {
    read_json(&baseline_path(root, id))
}

/// 开始记录一轮修改：先保存基线，Agent 之后才允许改文件。
pub fn begin(
    root: &Path,
    source: &str,
    summary: Option<String>,
    paths: Vec<String>,
) -> CommandResult<ChangeSet> {
    let id = new_change_set_id();
    let set = ChangeSet {
        id: id.clone(),
        source: source.to_string(),
        created_at: timestamp(),
        completed_at: None,
        status: ChangeSetStatus::Recording,
        summary,
        files: Vec::new(),
        decision: None,
    };
    write_json(&changeset_path(root, &id), &set)?;
    write_json(
        &baseline_path(root, &id),
        &Baseline {
            id: id.clone(),
            records: Vec::new(),
        },
    )?;
    let set = track(root, &id, paths)?;
    Ok(set)
}

/// 追加需要跟踪的文件；必须在 Agent 修改之前调用。
pub fn track(root: &Path, id: &str, paths: Vec<String>) -> CommandResult<ChangeSet> {
    let mut set = read_changeset(root, id)?;
    if set.status != ChangeSetStatus::Recording {
        return Err(command_error(
            "CHANGESET_NOT_RECORDING",
            "本轮修改已经记录完成，不能再追加文件。",
        ));
    }
    let mut baseline = read_baseline(root, id)?;
    let known: HashMap<String, ()> = baseline
        .records
        .iter()
        .map(|record| (record.path.clone(), ()))
        .collect();
    let mut next_slot = baseline.records.len();
    for raw in paths {
        let target = path_from_string(&raw)?;
        if known.contains_key(&target.to_string_lossy().into_owned()) {
            continue;
        }
        let path_text = target.to_string_lossy().into_owned();
        let metadata = match fs::metadata(&target) {
            Ok(value) if value.is_file() => Some(value),
            _ => None,
        };
        let record = match metadata {
            Some(value) => {
                let bytes =
                    fs::read(&target).map_err(|error| io_error("READ_FAILED", &target, error))?;
                let slot = next_slot;
                next_slot += 1;
                let blob = blob_path(root, id, slot);
                if let Some(parent) = blob.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| io_error("CREATE_DIR_FAILED", parent, error))?;
                }
                fs::write(&blob, &bytes)
                    .map_err(|error| io_error("WRITE_FAILED", &blob, error))?;
                BaselineRecord {
                    path: path_text,
                    slot: Some(slot),
                    existed: true,
                    size: value.len(),
                    modified_time: crate::models::file::modified_time(&value),
                }
            }
            _ => BaselineRecord {
                path: path_text,
                slot: None,
                existed: false,
                size: 0,
                modified_time: 0,
            },
        };
        baseline.records.push(record);
    }
    write_json(&baseline_path(root, id), &baseline)?;
    set.files = baseline
        .records
        .iter()
        .map(|record| FileChange {
            path: record.path.clone(),
            kind: FileChangeKind::Unchanged,
            before_size: record.size,
            after_size: record.size,
            added_lines: 0,
            removed_lines: 0,
            text_diffable: false,
        })
        .collect();
    write_json(&changeset_path(root, id), &set)?;
    Ok(set)
}

fn as_text(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() as u64 > TEXT_LIMIT {
        return if bytes.is_empty() {
            Some(String::new())
        } else {
            None
        };
    }
    std::str::from_utf8(bytes).ok().map(|value| value.to_string())
}

/// 行级增减数：按行内容做多重集比较，稳定且不受顺序影响。
pub fn line_delta(before: &str, after: &str) -> (usize, usize) {
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for line in before.lines() {
        *counts.entry(line).or_insert(0) += 1;
    }
    let mut added = 0usize;
    let mut removed = 0usize;
    for line in after.lines() {
        let entry = counts.entry(line).or_insert(0);
        if *entry > 0 {
            *entry -= 1;
        } else {
            added += 1;
        }
    }
    for left in counts.values() {
        if *left > 0 {
            removed += *left as usize;
        }
    }
    (added, removed)
}

/// 采集本轮结果：对比基线与磁盘现状，生成文件级变更并进入待审状态。
pub fn capture(root: &Path, id: &str) -> CommandResult<ChangeSet> {
    let mut set = read_changeset(root, id)?;
    if set.status != ChangeSetStatus::Recording {
        return Ok(set);
    }
    let baseline = read_baseline(root, id)?;
    let mut changes = Vec::with_capacity(baseline.records.len());
    for record in &baseline.records {
        let target = path_from_string(&record.path)?;
        let current = fs::read(&target).ok();
        let kind = match (record.existed, &current) {
            (true, None) => FileChangeKind::Deleted,
            (false, Some(_)) => FileChangeKind::Added,
            (true, Some(bytes)) => {
                let before = fs::read(blob_path(root, id, record.slot.unwrap_or_default()))
                    .unwrap_or_default();
                if before == *bytes {
                    FileChangeKind::Unchanged
                } else {
                    FileChangeKind::Modified
                }
            }
            (false, None) => FileChangeKind::Unchanged,
        };
        let before_bytes = record
            .slot
            .map(|slot| fs::read(blob_path(root, id, slot)).unwrap_or_default())
            .unwrap_or_default();
        let after_bytes = current.clone().unwrap_or_default();
        let before_text = if record.existed {
            as_text(&before_bytes)
        } else {
            Some(String::new())
        };
        let after_text = if current.is_some() {
            as_text(&after_bytes)
        } else {
            Some(String::new())
        };
        let text_diffable = before_text.is_some() && after_text.is_some();
        let (added_lines, removed_lines) = if text_diffable {
            line_delta(&before_text.unwrap_or_default(), &after_text.unwrap_or_default())
        } else {
            (0, 0)
        };
        changes.push(FileChange {
            path: record.path.clone(),
            kind,
            before_size: record.size,
            after_size: after_bytes.len() as u64,
            added_lines,
            removed_lines,
            text_diffable,
        });
    }
    set.files = changes;
    set.status = ChangeSetStatus::Pending;
    set.completed_at = Some(timestamp());
    write_json(&changeset_path(root, id), &set)?;
    prune_audit(root)?;
    Ok(set)
}

pub fn diff_texts(root: &Path, id: &str, path: &str) -> CommandResult<(Option<String>, Option<String>)> {
    let baseline = read_baseline(root, id)?;
    let record = baseline
        .records
        .iter()
        .find(|record| record.path == path)
        .ok_or_else(|| command_error("FILE_NOT_TRACKED", format!("本轮没有跟踪 {path}。")))?;
    let before = record
        .slot
        .and_then(|slot| fs::read(blob_path(root, id, slot)).ok())
        .and_then(|bytes| as_text(&bytes));
    let after = fs::read(path_from_string(path)?).ok().and_then(|bytes| as_text(&bytes));
    Ok((before, after))
}

fn mark_decided(root: &Path, mut set: ChangeSet, status: ChangeSetStatus, reason: Option<String>) -> CommandResult<ChangeSet> {
    set.status = status;
    set.decision = Some(ChangeDecision {
        decided_at: timestamp(),
        reason,
    });
    write_json(&changeset_path(root, &set.id), &set)?;
    let directory = rollback_dir(root, &set.id);
    if directory.exists() {
        let _ = fs::remove_dir_all(&directory);
    }
    prune_audit(root)?;
    Ok(set)
}

/// 用户确认：只保留审批记录，回滚内容随即删除。
pub fn approve(root: &Path, id: &str) -> CommandResult<ChangeSet> {
    let set = read_changeset(root, id)?;
    if set.status != ChangeSetStatus::Pending {
        return Err(command_error(
            "CHANGESET_NOT_PENDING",
            "只有待审批的修改轮次可以确认。",
        ));
    }
    mark_decided(root, set, ChangeSetStatus::Approved, None)
}

/// 回滚：把基线写回磁盘（本轮新建的文件删除），然后丢弃回滚数据。
pub fn reject(root: &Path, id: &str, reason: Option<String>) -> CommandResult<ChangeSet> {
    let set = read_changeset(root, id)?;
    if set.status != ChangeSetStatus::Pending {
        return Err(command_error(
            "CHANGESET_NOT_PENDING",
            "只有待审批的修改轮次可以回滚。",
        ));
    }
    let baseline = read_baseline(root, id)?;
    for record in &baseline.records {
        let target = path_from_string(&record.path)?;
        match (record.existed, record.slot) {
            (true, Some(slot)) => {
                let bytes = fs::read(blob_path(root, id, slot))
                    .map_err(|error| io_error("READ_FAILED", &blob_path(root, id, slot), error))?;
                fs::write(&target, bytes).map_err(|error| io_error("WRITE_FAILED", &target, error))?;
            }
            (false, _) => {
                if target.exists() {
                    let _ = fs::remove_file(&target);
                }
            }
            _ => {}
        }
    }
    mark_decided(root, set, ChangeSetStatus::Rejected, reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("quickedit-review-{name}-{}", timestamp()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, text: &str) {
        fs::write(path, text).unwrap();
    }

    #[test]
    fn line_delta_counts_added_and_removed_lines() {
        assert_eq!(line_delta("a\nb\nc", "a\nx\nb\nc"), (1, 0));
        assert_eq!(line_delta("a\nb\nc", "a\nc"), (0, 1));
        assert_eq!(line_delta("same", "same"), (0, 0));
    }

    #[test]
    fn capture_reports_modified_added_deleted_and_line_counts() {
        let temp = TempDir::new("capture");
        let root = temp.0.clone();
        let file_a = root.join("a.txt");
        let file_b = root.join("b.txt");
        write(&file_a, "1\n2\n3\n");
        let set = begin(&root, "agent", Some("测试".into()), vec![
            file_a.to_string_lossy().into_owned(),
            file_b.to_string_lossy().into_owned(),
        ])
        .unwrap();
        assert_eq!(set.files.len(), 2);
        write(&file_a, "1\n2\n3\n4\n");
        write(&file_b, "new\n");
        let captured = capture(&root, &set.id).unwrap();
        assert_eq!(captured.status, ChangeSetStatus::Pending);
        let a = captured.files.iter().find(|item| item.path == file_a.to_string_lossy()).unwrap();
        assert_eq!(a.kind, FileChangeKind::Modified);
        assert_eq!((a.added_lines, a.removed_lines), (1, 0));
        assert!(a.text_diffable);
        let b = captured.files.iter().find(|item| item.path == file_b.to_string_lossy()).unwrap();
        assert_eq!(b.kind, FileChangeKind::Added);
        let removed = begin(&root, "agent", None, vec![file_a.to_string_lossy().into_owned()]).unwrap();
        fs::remove_file(&file_a).unwrap();
        let deleted = capture(&root, &removed.id).unwrap();
        assert_eq!(deleted.files[0].kind, FileChangeKind::Deleted);
        assert_eq!(deleted.files[0].removed_lines, 4);
        assert_eq!(deleted.files[0].after_size, 0);
    }

    #[test]
    fn reject_restores_baseline_and_removes_created_files() {
        let temp = TempDir::new("reject");
        let root = temp.0.clone();
        let kept = root.join("keep.txt");
        let created = root.join("created.txt");
        write(&kept, "原始内容\n");
        let set = begin(
            &root,
            "agent",
            None,
            vec![
                kept.to_string_lossy().into_owned(),
                created.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();
        write(&kept, "改过的内容\n第二行\n");
        write(&created, "新文件\n");
        capture(&root, &set.id).unwrap();
        let rejected = reject(&root, &set.id, Some("不符合要求".into())).unwrap();
        assert_eq!(rejected.status, ChangeSetStatus::Rejected);
        assert_eq!(fs::read_to_string(&kept).unwrap(), "原始内容\n");
        assert!(!created.exists());
        // 回滚数据已清理，审批记录仍在
        assert!(!rollback_dir(&root, &set.id).exists());
        assert!(changeset_path(&root, &set.id).exists());
        assert_eq!(rejected.decision.unwrap().reason.unwrap(), "不符合要求");
    }

    #[test]
    fn approve_keeps_disk_and_drops_rollback_payload() {
        let temp = TempDir::new("approve");
        let root = temp.0.clone();
        let file = root.join("f.txt");
        write(&file, "one\n");
        let set = begin(&root, "agent", None, vec![file.to_string_lossy().into_owned()]).unwrap();
        write(&file, "one\ntwo\n");
        capture(&root, &set.id).unwrap();
        let approved = approve(&root, &set.id).unwrap();
        assert_eq!(approved.status, ChangeSetStatus::Approved);
        assert_eq!(fs::read_to_string(&file).unwrap(), "one\ntwo\n");
        assert!(!rollback_dir(&root, &set.id).exists());
    }

    #[test]
    fn approving_twice_is_rejected_as_not_pending() {
        let temp = TempDir::new("twice");
        let root = temp.0.clone();
        let file = root.join("g.txt");
        write(&file, "x\n");
        let set = begin(&root, "agent", None, vec![file.to_string_lossy().into_owned()]).unwrap();
        capture(&root, &set.id).unwrap();
        approve(&root, &set.id).unwrap();
        let failure = approve(&root, &set.id);
        assert_eq!(failure.unwrap_err().code, "CHANGESET_NOT_PENDING");
    }

    #[test]
    fn diff_texts_returns_both_sides() {
        let temp = TempDir::new("diff");
        let root = temp.0.clone();
        let file = root.join("h.txt");
        write(&file, "a\nb\n");
        let set = begin(&root, "agent", None, vec![file.to_string_lossy().into_owned()]).unwrap();
        write(&file, "a\nb\nc\n");
        capture(&root, &set.id).unwrap();
        let (before, after) = diff_texts(&root, &set.id, &file.to_string_lossy()).unwrap();
        assert_eq!(before.unwrap(), "a\nb\n");
        assert_eq!(after.unwrap(), "a\nb\nc\n");
    }
}
