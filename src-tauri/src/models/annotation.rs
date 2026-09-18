use serde::{Deserialize, Deserializer, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

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

pub fn now_iso8601() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
