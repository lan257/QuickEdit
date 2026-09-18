use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const CONFIG_FILE: &str = "config.json";
const WORKSPACE_FILE: &str = "workspace.json";
const DEFAULT_MAX_TEXT_FILE_SIZE_MB: u64 = 1;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

type CommandResult<T> = Result<T, CommandError>;

fn command_error(code: &str, message: impl Into<String>) -> CommandError {
    CommandError {
        code: code.to_string(),
        message: message.into(),
    }
}

fn io_error(code: &str, path: &Path, error: std::io::Error) -> CommandError {
    command_error(code, format!("{}: {}", path.display(), error))
}

fn modified_time(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn created_time(metadata: &fs::Metadata) -> u64 {
    metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn path_from_string(path: &str) -> CommandResult<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(command_error("INVALID_PATH", "路径不能为空。"));
    }
    Ok(PathBuf::from(trimmed))
}

/// 按文件名计算扩展名（含前导点），无扩展名返回空字符串。
/// 对 `.gitignore` 这类“只有后缀、没有文件名”的点文件，
/// `Path::extension()` 会返回 None，因此这里改为按最后一个句点切分。
fn extension_of(name: &str) -> String {
    match name.rfind('.') {
        Some(index) if index + 1 < name.len() => name[index..].to_string(),
        _ => String::new(),
    }
}

fn metadata_for_path(path: &Path) -> CommandResult<FileMetadata> {
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AnnotationTarget {
    pub name: String,
    pub size: u64,
    pub modified_time: u64,
}

fn deserialize_annotation_target<'de, D>(deserializer: D) -> Result<AnnotationTarget, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Object(_) => serde_json::from_value(value).map_err(serde::de::Error::custom),
        serde_json::Value::String(name) => Ok(AnnotationTarget {
            name,
            ..AnnotationTarget::default()
        }),
        _ => Err(serde::de::Error::custom("批注 target 必须是对象或旧字符串格式")),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AnnotationEntry {
    pub id: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locator: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub text: String,
    pub created_at: String,
    pub updated_at: String,
}

impl Default for AnnotationEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            scope: "general".to_string(),
            locator: None,
            anchor: None,
            status: None,
            tags: None,
            source: None,
            text: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AnnotationDocument {
    pub version: u8,
    #[serde(deserialize_with = "deserialize_annotation_target")]
    pub target: AnnotationTarget,
    pub updated_at: String,
    pub annotations: Vec<AnnotationEntry>,
}

impl Default for AnnotationDocument {
    fn default() -> Self {
        Self {
            version: 1,
            target: AnnotationTarget::default(),
            updated_at: String::new(),
            annotations: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationState {
    pub path: String,
    pub exists: bool,
    pub stale: bool,
    pub document: AnnotationDocument,
}

fn now_iso8601() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorConfig {
    pub max_text_file_size_mb: u64,
    pub confirm_before_close_unsaved: bool,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            max_text_file_size_mb: DEFAULT_MAX_TEXT_FILE_SIZE_MB,
            confirm_before_close_unsaved: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct TextHandlerConfig {
    pub enabled: bool,
    pub extensions: Vec<String>,
}

impl Default for TextHandlerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            extensions: vec![
                ".txt", ".md", ".json", ".xml", ".yaml", ".yml", ".ini", ".log", ".csv", ".sql",
                ".py", ".js", ".ts", ".cs", ".java", ".cpp", ".html", ".css",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct FileHandlerConfig {
    pub enabled: bool,
    pub extensions: Vec<String>,
}

impl Default for FileHandlerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            extensions: Vec::new(),
        }
    }
}

fn default_spreadsheet_handler() -> FileHandlerConfig {
    FileHandlerConfig {
        enabled: true,
        extensions: vec![".xlsx".to_string()],
    }
}

fn default_pdf_handler() -> FileHandlerConfig {
    FileHandlerConfig {
        enabled: true,
        extensions: vec![".pdf".to_string()],
    }
}

fn default_docx_handler() -> FileHandlerConfig {
    FileHandlerConfig {
        enabled: true,
        extensions: vec![".docx".to_string()],
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HandlerConfig {
    pub text: TextHandlerConfig,
    #[serde(default = "default_spreadsheet_handler")]
    pub spreadsheet: FileHandlerConfig,
    #[serde(default = "default_pdf_handler")]
    pub pdf: FileHandlerConfig,
    #[serde(default = "default_docx_handler")]
    pub docx: FileHandlerConfig,
}

impl Default for HandlerConfig {
    fn default() -> Self {
        Self {
            text: TextHandlerConfig::default(),
            spreadsheet: FileHandlerConfig {
                enabled: true,
                extensions: vec![".xlsx".to_string()],
            },
            pdf: FileHandlerConfig {
                enabled: true,
                extensions: vec![".pdf".to_string()],
            },
            docx: FileHandlerConfig {
                enabled: true,
                extensions: vec![".docx".to_string()],
            },
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AnnotationConfig {
    pub enabled: bool,
    pub extension: String,
}

impl Default for AnnotationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            extension: ".qnote".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceConfig {
    pub restore_last_session: bool,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            restore_last_session: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceConfig {
    pub theme: String,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self { theme: "light".to_string() }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellConfig {
    pub context_menu: bool,
    pub open_with: bool,
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            context_menu: true,
            open_with: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub version: u8,
    pub editor: EditorConfig,
    pub handlers: HandlerConfig,
    pub annotations: AnnotationConfig,
    pub workspace: WorkspaceConfig,
    pub shell: ShellConfig,
    pub appearance: AppearanceConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            editor: EditorConfig::default(),
            handlers: HandlerConfig::default(),
            annotations: AnnotationConfig::default(),
            workspace: WorkspaceConfig::default(),
            shell: ShellConfig::default(),
            appearance: AppearanceConfig::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceReference {
    pub name: String,
    pub path: String,
    pub expanded: bool,
}

impl Default for WorkspaceReference {
    fn default() -> Self {
        Self {
            name: String::new(),
            path: String::new(),
            expanded: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceState {
    pub version: u8,
    pub docs_files: Vec<String>,
    pub workspaces: Vec<WorkspaceReference>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            version: 2,
            docs_files: Vec::new(),
            workspaces: Vec::new(),
        }
    }
}

fn config_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| command_error("APP_PATH_FAILED", error.to_string()))?;
    fs::create_dir_all(&directory)
        .map_err(|error| io_error("CREATE_CONFIG_DIR_FAILED", &directory, error))?;
    Ok(directory.join(CONFIG_FILE))
}

fn workspace_path(app: &AppHandle) -> CommandResult<PathBuf> {
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

fn atomic_write(path: &Path, bytes: &[u8]) -> CommandResult<()> {
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

fn read_json_or_default<T>(path: &Path) -> CommandResult<T>
where
    T: for<'de> Deserialize<'de> + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    let content =
        fs::read_to_string(path).map_err(|error| io_error("READ_JSON_FAILED", path, error))?;
    serde_json::from_str(&content)
        .map_err(|error| command_error("INVALID_JSON", format!("{}: {error}", path.display())))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> CommandResult<()> {
    let content = serde_json::to_vec_pretty(value)
        .map_err(|error| command_error("SERIALIZE_FAILED", error.to_string()))?;
    atomic_write(path, &content)
}

fn annotation_path(app: &AppHandle, target_path: &Path) -> CommandResult<PathBuf> {
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

fn annotation_target(metadata: &FileMetadata) -> AnnotationTarget {
    AnnotationTarget {
        name: metadata.name.clone(),
        size: metadata.size,
        modified_time: metadata.modified_time,
    }
}

fn annotation_target_is_stale(target: &AnnotationTarget, metadata: &FileMetadata) -> bool {
    if target.name.is_empty() || (target.size == 0 && target.modified_time == 0) {
        return false;
    }
    target.name != metadata.name
        || target.size != metadata.size
        || target.modified_time != metadata.modified_time
}

fn refresh_annotation_document(document: &mut AnnotationDocument, metadata: &FileMetadata) {
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

fn validate_child_name(name: &str) -> CommandResult<&str> {
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

fn decode_text(bytes: &[u8]) -> CommandResult<(String, String)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let content = String::from_utf8(bytes[3..].to_vec())
            .map_err(|_| command_error("ENCODING_UNSUPPORTED", "文件不是有效的 UTF-8 文本。"))?;
        return Ok((content, "utf-8-bom".to_string()));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let payload = &bytes[2..];
        if payload.len() % 2 != 0 {
            return Err(command_error(
                "ENCODING_UNSUPPORTED",
                "文件不是完整的 UTF-16LE 文本。",
            ));
        }
        let units: Vec<u16> = payload
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        let content = String::from_utf16(&units)
            .map_err(|_| command_error("ENCODING_UNSUPPORTED", "文件不是有效的 UTF-16LE 文本。"))?;
        return Ok((content, "utf-16le".to_string()));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let payload = &bytes[2..];
        if payload.len() % 2 != 0 {
            return Err(command_error(
                "ENCODING_UNSUPPORTED",
                "文件不是完整的 UTF-16BE 文本。",
            ));
        }
        let units: Vec<u16> = payload
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        let content = String::from_utf16(&units)
            .map_err(|_| command_error("ENCODING_UNSUPPORTED", "文件不是有效的 UTF-16BE 文本。"))?;
        return Ok((content, "utf-16be".to_string()));
    }

    let content = String::from_utf8(bytes.to_vec()).map_err(|_| {
        command_error(
            "ENCODING_UNSUPPORTED",
            "无法可靠识别文件编码；为避免静默损坏，已拒绝加载。",
        )
    })?;
    Ok((content, "utf-8".to_string()))
}

fn encode_text(content: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "utf-8-bom" => {
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(content.as_bytes());
            bytes
        }
        "utf-16le" => {
            let mut bytes = vec![0xFF, 0xFE];
            for unit in content.encode_utf16() {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
            bytes
        }
        "utf-16be" => {
            let mut bytes = vec![0xFE, 0xFF];
            for unit in content.encode_utf16() {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
            bytes
        }
        _ => content.as_bytes().to_vec(),
    }
}

#[tauri::command]
fn load_config(app: AppHandle) -> CommandResult<AppConfig> {
    let path = config_path(&app)?;
    read_json_or_default(&path)
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> CommandResult<()> {
    let path = config_path(&app)?;
    write_json(&path, &config)
}

#[tauri::command]
fn load_workspace(app: AppHandle) -> CommandResult<WorkspaceState> {
    let path = workspace_path(&app)?;
    read_json_or_default(&path)
}

#[tauri::command]
fn save_workspace(app: AppHandle, state: WorkspaceState) -> CommandResult<()> {
    let path = workspace_path(&app)?;
    write_json(&path, &state)
}

#[tauri::command]
fn get_documents_directory(app: AppHandle) -> CommandResult<String> {
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
fn get_file_metadata(path: String) -> CommandResult<FileMetadata> {
    let file_path = path_from_string(&path)?;
    metadata_for_path(&file_path)
}

#[tauri::command]
fn list_directory(path: String) -> CommandResult<Vec<FileMetadata>> {
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
fn read_text_file(app: AppHandle, path: String) -> CommandResult<TextDocument> {
    let file_path = path_from_string(&path)?;
    let metadata =
        fs::metadata(&file_path).map_err(|error| io_error("STAT_FAILED", &file_path, error))?;
    if metadata.is_dir() {
        return Err(command_error("NOT_FILE", "目录不能作为文本文件加载。"));
    }

    let config = load_config(app)?;
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
fn save_text_file(
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
fn read_binary_file(path: String) -> CommandResult<Vec<u8>> {
    let file_path = path_from_string(&path)?;
    let metadata = fs::metadata(&file_path)
        .map_err(|error| io_error("STAT_FAILED", &file_path, error))?;
    if metadata.is_dir() {
        return Err(command_error("NOT_FILE", "目录不能作为二进制文档加载。"));
    }
    fs::read(&file_path).map_err(|error| io_error("READ_FILE_FAILED", &file_path, error))
}

#[tauri::command]
fn save_binary_file(
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
fn create_folder(parent_path: String, name: String) -> CommandResult<FileMetadata> {
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
fn create_document(
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
fn load_annotations(app: AppHandle, target_path: String) -> CommandResult<AnnotationState> {
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
fn recover_annotations(app: AppHandle, target_path: String) -> CommandResult<AnnotationState> {
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
fn save_annotations(
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

#[tauri::command]
fn rename_document(
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

static LAUNCH_PATHS: OnceLock<Vec<String>> = OnceLock::new();

fn collect_launch_paths() {
    let paths: Vec<String> = std::env::args().skip(1).filter(|item| !item.is_empty()).collect();
    let _ = LAUNCH_PATHS.set(paths);
}

#[tauri::command]
fn take_launch_paths() -> Vec<String> {
    LAUNCH_PATHS.get().cloned().unwrap_or_default()
}

#[cfg(windows)]
fn run_reg(args: &[&str]) -> CommandResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("reg")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| command_error("REG_LAUNCH_FAILED", error.to_string()))?;
    if !output.status.success() {
        return Err(command_error(
            "REG_FAILED",
            format!("reg {}: {}", args.join(" "), String::from_utf8_lossy(&output.stderr).trim()),
        ));
    }
    Ok(())
}

fn terminal_working_dir(cwd: Option<String>) -> CommandResult<PathBuf> {
    let working_dir = cwd
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| command_error("TERMINAL_CWD_FAILED", "无法确定 Terminal 工作目录。"))?;
    if !working_dir.is_dir() {
        return Err(command_error("TERMINAL_CWD_FAILED", "Terminal 工作目录不是有效文件夹。"));
    }
    Ok(working_dir)
}

#[tauri::command]
fn launch_terminal(cwd: Option<String>) -> CommandResult<()> {
    let working_dir = terminal_working_dir(cwd)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        Command::new("cmd.exe")
            .arg("/K")
            .arg("cd")
            .arg("/d")
            .arg(working_dir.as_os_str())
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|error| command_error("TERMINAL_LAUNCH_FAILED", error.to_string()))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = working_dir;
        Err(command_error("UNSUPPORTED_PLATFORM", "仅 Windows 支持外部 Terminal。"))
    }
}

struct TerminalSession {
    writer: Box<dyn std::io::Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

impl TerminalSession {
    fn shutdown(&mut self) {
        let _ = self.killer.kill();
        let _ = self.writer.flush();
    }
}

#[derive(Default)]
struct TerminalState {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

fn lock_terminal_state(
    sessions: &Mutex<HashMap<String, TerminalSession>>,
) -> std::sync::MutexGuard<'_, HashMap<String, TerminalSession>> {
    sessions.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    session_id: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
}

#[tauri::command]
fn terminal_spawn(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    cwd: Option<String>,
    shell: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> CommandResult<()> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use tauri::Emitter;

    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(command_error("TERMINAL_SESSION_INVALID", "Terminal 会话标识不能为空。"));
    }
    let working_dir = terminal_working_dir(cwd)?;
    let shell_name = shell
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("powershell")
        .to_ascii_lowercase();
    let program = match shell_name.as_str() {
        "cmd" => "cmd.exe",
        _ => "powershell.exe",
    };

    {
        let mut sessions = lock_terminal_state(&state.sessions);
        if let Some(mut previous) = sessions.remove(&session_id) {
            previous.shutdown();
        }
    }

    let size = PtySize {
        rows: rows.unwrap_or(24).max(1),
        cols: cols.unwrap_or(80).max(1),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| command_error("TERMINAL_SPAWN_FAILED", error.to_string()))?;
    let mut command = CommandBuilder::new(program);
    command.cwd(&working_dir);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| command_error("TERMINAL_SPAWN_FAILED", error.to_string()))?;
    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| command_error("TERMINAL_SPAWN_FAILED", error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| command_error("TERMINAL_SPAWN_FAILED", error.to_string()))?;
    drop(pair.slave);

    let emit_app = app.clone();
    let emit_session_id = session_id.clone();
    std::thread::spawn(move || {
        use base64::Engine;
        use std::io::Read;
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let payload = TerminalOutputEvent {
                        session_id: emit_session_id.clone(),
                        data: base64::engine::general_purpose::STANDARD.encode(&buffer[..size]),
                    };
                    if emit_app.emit("terminal-output", payload).is_err() {
                        return;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = emit_app.emit("terminal-exit", TerminalExitEvent { session_id: emit_session_id });
    });

    let mut sessions = lock_terminal_state(&state.sessions);
    sessions.insert(session_id, TerminalSession { writer, master: pair.master, killer });
    Ok(())
}

#[tauri::command]
fn terminal_write(
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> CommandResult<()> {
    let mut sessions = lock_terminal_state(&state.sessions);
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| command_error("TERMINAL_NOT_RUNNING", "内置终端未运行。"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| command_error("TERMINAL_WRITE_FAILED", error.to_string()))
}

#[tauri::command]
fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> CommandResult<()> {
    use portable_pty::PtySize;
    let sessions = lock_terminal_state(&state.sessions);
    if let Some(session) = sessions.get(&session_id) {
        session
            .master
            .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|error| command_error("TERMINAL_RESIZE_FAILED", error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
fn terminal_kill(state: tauri::State<'_, TerminalState>, session_id: String) -> CommandResult<()> {
    let mut sessions = lock_terminal_state(&state.sessions);
    if let Some(mut session) = sessions.remove(&session_id) {
        session.shutdown();
    }
    Ok(())
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> CommandResult<()> {
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

#[tauri::command]
fn set_shell_integration(kind: String, enabled: bool) -> CommandResult<()> {
    let exe = std::env::current_exe()
        .map_err(|error| command_error("EXE_PATH_FAILED", error.to_string()))?;
    let exe_str = exe.to_string_lossy().into_owned();
    let open_command = format!("\"{exe_str}\" \"%1\"");

    #[cfg(windows)]
    match kind.as_str() {
        "contextMenu" => {
            if enabled {
                for key in [
                    r"Software\Classes\*\shell\QuickEdit",
                    r"Software\Classes\Directory\shell\QuickEdit",
                ] {
                    run_reg(&["add", &format!("HKCU\\{key}"), "/v", "MUIVerb", "/t", "REG_SZ", "/d", "Open with QuickEdit", "/f"])?;
                    run_reg(&["add", &format!("HKCU\\{key}"), "/v", "Icon", "/t", "REG_SZ", "/d", &exe_str, "/f"])?;
                    run_reg(&["add", &format!("HKCU\\{key}\\command"), "/ve", "/t", "REG_SZ", "/d", &open_command, "/f"])?;
                }
            } else {
                for key in [
                    r"Software\Classes\*\shell\QuickEdit",
                    r"Software\Classes\Directory\shell\QuickEdit",
                ] {
                    let _ = run_reg(&["delete", &format!("HKCU\\{key}"), "/f"]);
                }
            }
        }
        "openWith" => {
            if enabled {
                run_reg(&["add", r"HKCU\Software\Classes\Applications\quickedit.exe", "/ve", "/t", "REG_SZ", "/d", "QuickEdit", "/f"])?;
                run_reg(&["add", r"HKCU\Software\Classes\Applications\quickedit.exe\shell\open\command", "/ve", "/t", "REG_SZ", "/d", &open_command, "/f"])?;
            } else {
                let _ = run_reg(&["delete", r"HKCU\Software\Classes\Applications\quickedit.exe", "/f"]);
            }
        }
        _ => return Err(command_error("INVALID_KIND", "未知的 Shell 集成类型。")),
    }
    #[cfg(not(windows))]
    let _ = (exe_str, open_command);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    collect_launch_paths();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths: Vec<String> = args.into_iter().skip(1).filter(|item| !item.is_empty()).collect();
            use tauri::Emitter;
            let _ = app.emit("open-paths", paths);
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            take_launch_paths,
            launch_terminal,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            reveal_in_explorer,
            set_shell_integration,
            load_config,
            save_config,
            load_workspace,
            save_workspace,
            get_documents_directory,
            get_file_metadata,
            list_directory,
            read_text_file,
            save_text_file,
            read_binary_file,
            save_binary_file,
            create_folder,
            create_document,
            load_annotations,
            recover_annotations,
            save_annotations,
            rename_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_keeps_one_mb_text_limit() {
        let config = AppConfig::default();
        assert_eq!(config.editor.max_text_file_size_mb, 1);
        assert!(config
            .handlers
            .text
            .extensions
            .iter()
            .any(|item| item == ".md"));
    }

    #[test]
    fn decodes_utf8_bom_without_exposing_bom() {
        let (content, encoding) = decode_text(&[0xEF, 0xBB, 0xBF, b'Q', b'E']).unwrap();
        assert_eq!(content, "QE");
        assert_eq!(encoding, "utf-8-bom");
    }

    #[test]
    fn round_trips_utf16le() {
        let bytes = encode_text("你好", "utf-16le");
        let (content, encoding) = decode_text(&bytes).unwrap();
        assert_eq!(content, "你好");
        assert_eq!(encoding, "utf-16le");
    }

    #[test]
    fn rejects_malformed_utf16_instead_of_silently_truncating() {
        let failure = decode_text(&[0xFF, 0xFE, 0xFF]);
        assert_eq!(failure.unwrap_err().code, "ENCODING_UNSUPPORTED");
    }

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

    #[test]
    fn accepts_legacy_qnote_target_string_and_serializes_object() {
        let document: AnnotationDocument = serde_json::from_str(
            r#"{"version":1,"target":"notes.md","updatedAt":"","annotations":[]}"#,
        )
        .unwrap();
        assert_eq!(document.target.name, "notes.md");
        let value = serde_json::to_value(document).unwrap();
        assert!(value["target"].is_object());
    }
}
