use crate::error::{command_error, CommandResult};

pub fn decode_text(bytes: &[u8]) -> CommandResult<(String, String)> {
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

pub fn encode_text(content: &str, encoding: &str) -> Vec<u8> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
