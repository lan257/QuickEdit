use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::error::{command_error, io_error, CommandResult};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub modified_time: u64,
    pub created_time: u64,
    pub is_directory: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocument {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub size: u64,
    pub modified_time: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChunk {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub offset: u64,
    pub next_offset: u64,
    pub size: u64,
    pub modified_time: u64,
    pub eof: bool,
}

pub fn modified_time(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

pub fn created_time(metadata: &fs::Metadata) -> u64 {
    metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

pub fn path_from_string(path: &str) -> CommandResult<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(command_error("INVALID_PATH", "路径不能为空。"));
    }
    Ok(PathBuf::from(trimmed))
}

/// 按文件名计算扩展名（含前导点），无扩展名返回空字符串。
/// 对 `.gitignore` 这类“只有后缀、没有文件名”的点文件，
/// `Path::extension()` 会返回 None，因此这里改为按最后一个句点切分。
pub fn extension_of(name: &str) -> String {
    match name.rfind('.') {
        Some(index) if index + 1 < name.len() => name[index..].to_string(),
        _ => String::new(),
    }
}

pub fn metadata_for_path(path: &Path) -> CommandResult<FileMetadata> {
    let metadata = fs::metadata(path).map_err(|error| io_error("STAT_FAILED", path, error))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = extension_of(&name);

    Ok(FileMetadata {
        path: path.to_string_lossy().into_owned(),
        name,
        extension,
        size: metadata.len(),
        modified_time: modified_time(&metadata),
        created_time: created_time(&metadata),
        is_directory: metadata.is_dir(),
    })
}

pub fn validate_child_name(name: &str) -> CommandResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(command_error("INVALID_NAME", "名称不能为空。"));
    }
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if trimmed
        .chars()
        .any(|character| invalid.contains(&character))
    {
        return Err(command_error(
            "INVALID_NAME",
            "名称不能包含 Windows 非法字符。",
        ));
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err(command_error("INVALID_NAME", "名称不能以空格或句点结尾。"));
    }
    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_windows_path_separators_in_child_names() {
        assert!(validate_child_name("notes.txt").is_ok());
        assert!(validate_child_name("bad/name").is_err());
        assert!(validate_child_name("bad.").is_err());
    }

    #[test]
    fn extension_of_keeps_dotfile_names_as_extensions() {
        assert_eq!(extension_of(".gitignore"), ".gitignore");
        assert_eq!(extension_of(".env"), ".env");
        assert_eq!(extension_of(".env.local"), ".local");
    }

    #[test]
    fn extension_of_handles_normal_and_edge_names() {
        assert_eq!(extension_of("notes.txt"), ".txt");
        assert_eq!(extension_of("archive.tar.gz"), ".gz");
        assert_eq!(extension_of("Makefile"), "");
        assert_eq!(extension_of("trailing."), "");
        assert_eq!(extension_of(""), "");
    }
}
