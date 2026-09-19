use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeSetStatus {
    Recording,
    Pending,
    Approved,
    Rejected,
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileChangeKind {
    Added,
    Modified,
    Deleted,
    Unchanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: FileChangeKind,
    pub before_size: u64,
    pub after_size: u64,
    pub added_lines: usize,
    pub removed_lines: usize,
    /// 两边都是可解码文本时才可能做行级 diff（前端按需拉取内容）。
    pub text_diffable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeDecision {
    pub decided_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    pub id: String,
    pub source: String,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
    pub status: ChangeSetStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub files: Vec<FileChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<ChangeDecision>,
}
