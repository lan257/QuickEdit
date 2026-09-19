use crate::error::{command_error, CommandResult};

/// 只看首块前缀的 BOM；无 BOM 一律按 UTF-8 校验（与旧行为一致，不做猜测式转码）。
pub fn detect_encoding(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        "utf-8-bom"
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        "utf-16le"
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        "utf-16be"
    } else {
        "utf-8"
    }
}

pub fn bom_length(encoding: &str) -> usize {
    match encoding {
        "utf-8-bom" => 3,
        "utf-16le" | "utf-16be" => 2,
        _ => 0,
    }
}

/// 解码不含 BOM 的正文片段。
pub fn decode_payload(payload: &[u8], encoding: &str) -> CommandResult<String> {
    match encoding {
        "utf-16le" | "utf-16be" => {
            if payload.len() % 2 != 0 {
                return Err(command_error(
                    "ENCODING_UNSUPPORTED",
                    "文件不是完整的 UTF-16LE 文本。",
                ));
            }
            let units: Vec<u16> = if encoding == "utf-16be" {
                payload
                    .chunks_exact(2)
                    .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
                    .collect()
            } else {
                payload
                    .chunks_exact(2)
                    .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                    .collect()
            };
            String::from_utf16(&units)
                .map_err(|_| command_error("ENCODING_UNSUPPORTED", "文件不是有效的 UTF-16LE 文本。"))
        }
        _ => String::from_utf8(payload.to_vec()).map_err(|_| {
            command_error(
                "ENCODING_UNSUPPORTED",
                "无法可靠识别文件编码；为避免静默损坏，已拒绝加载。",
            )
        }),
    }
}

pub fn decode_text(bytes: &[u8]) -> CommandResult<(String, String)> {
    let encoding = detect_encoding(bytes);
    let payload = &bytes[bom_length(encoding)..];
    Ok((decode_payload(payload, encoding)?, encoding.to_string()))
}

fn utf8_sequence_length(lead: u8) -> usize {
    if lead < 0x80 {
        1
    } else if lead >> 5 == 0b110 {
        2
    } else if lead >> 4 == 0b1110 {
        3
    } else if lead >> 3 == 0b11110 {
        4
    } else {
        0
    }
}

/// 尾部若是不完整的 UTF-8 序列，切在该序列之前。
fn utf8_safe_length(payload: &[u8]) -> usize {
    let mut index = payload.len();
    let floor = payload.len().saturating_sub(4);
    while index > floor {
        let lead = payload[index - 1];
        if lead < 0x80 {
            return payload.len();
        }
        let length = utf8_sequence_length(lead);
        if length >= 2 {
            return if index - 1 + length <= payload.len() {
                payload.len()
            } else {
                index - 1
            };
        }
        index -= 1;
    }
    index
}

/// 分块读取时的安全切断位置：优先整行，其次保证编码单元（含代理对）不被截断。
/// `payload_start` 是窗口内去掉 BOM 后的正文起点，`has_more` 表示文件尚未读完。
pub fn chunk_cut(window: &[u8], encoding: &str, payload_start: usize, has_more: bool) -> usize {
    if !has_more {
        return window.len();
    }
    let unit = if encoding.starts_with("utf-16") { 2 } else { 1 };
    let start = payload_start.min(window.len());
    if has_more {
        for index in (start..window.len()).rev() {
            if window[index] != b'\n' {
                continue;
            }
            if unit == 1 {
                return index + 1;
            }
            let offset = index - start;
            // UTF-16LE 的换行是 [0x0A, 0x00]，整元结束在 index + 2；
            // UTF-16BE 是 [0x00, 0x0A]，整元结束在 index + 1。
            if offset % 2 == 0 && index + 2 <= window.len() && encoding != "utf-16be" {
                return index + 2;
            }
            if offset % 2 == 1 && encoding == "utf-16be" {
                return index + 1;
            }
        }
    }
    if unit == 2 {
        let aligned = start + (window.len() - start) / 2 * 2;
        if aligned <= start {
            return start;
        }
        let last = if encoding == "utf-16be" {
            u16::from_be_bytes([window[aligned - 2], window[aligned - 1]])
        } else {
            u16::from_le_bytes([window[aligned - 2], window[aligned - 1]])
        };
        return if (0xD800..=0xDBFF).contains(&last) {
            aligned - 2
        } else {
            aligned
        };
    }
    start + utf8_safe_length(&window[start..])
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

    #[test]
    fn chunk_prefers_the_last_complete_line() {
        let window = b"first line\nsecond line\nthi";
        assert_eq!(&window[..chunk_cut(window, "utf-8", 0, true)], b"first line\nsecond line\n");
    }

    #[test]
    fn chunk_never_splits_a_multibyte_utf8_character() {
        // “中” = E4 B8 AD，窗口只装下前两个字节时必须整字符退回
        let mut window = b"a".to_vec();
        window.extend_from_slice(&[0xE4, 0xB8]);
        let cut = chunk_cut(&window, "utf-8", 0, true);
        assert_eq!(cut, 1);
        assert!(std::str::from_utf8(&window[..cut]).is_ok());
        // 完整字符留在窗口内则不必回退
        let mut whole = b"a".to_vec();
        whole.extend_from_slice("中".as_bytes());
        assert_eq!(chunk_cut(&whole, "utf-8", 0, true), whole.len());
    }

    #[test]
    fn chunk_keeps_ascii_tail_when_no_newline_present() {
        let window = b"no newline here at all";
        assert_eq!(chunk_cut(window, "utf-8", 0, true), window.len());
    }

    #[test]
    fn chunk_at_eof_returns_everything() {
        let window = "结尾没有换行".as_bytes();
        assert_eq!(chunk_cut(window, "utf-8", 0, false), window.len());
    }

    #[test]
    fn utf16_chunk_cuts_on_unit_boundary_after_newline() {
        let mut window = encode_text("行一\n行二\n", "utf-16le");
        window.extend_from_slice(&[0x41, 0x00]);
        let payload_start = bom_length("utf-16le");
        let cut = chunk_cut(&window, "utf-16le", payload_start, true);
        assert_eq!((cut - payload_start) % 2, 0);
        assert_eq!(decode_payload(&window[payload_start..cut], "utf-16le").unwrap(), "行一\n行二\n");
    }

    #[test]
    fn utf16_chunk_does_not_split_a_surrogate_pair() {
        // “𐐀” = D800 DC00；窗口停在高位代理时（低位缺失）必须退到代理对之前
        let mut window = encode_text("ab", "utf-16le");
        window.extend_from_slice(&[0x00, 0xD8]);
        let payload_start = bom_length("utf-16le");
        let cut = chunk_cut(&window, "utf-16le", payload_start, true);
        assert_eq!(cut, payload_start + 4);
        assert_eq!(
            decode_payload(&window[payload_start..cut], "utf-16le").unwrap(),
            "ab"
        );
    }

    #[test]
    fn chunks_reassemble_into_the_original_text() {
        let original = "第一行 你好\nsecond line\n𐐀 尾行没有换行";
        let encoded = encode_text(original, "utf-8");
        let mut offset = 0usize;
        let mut rebuilt = String::new();
        while offset < encoded.len() {
            let end = (offset + 7).min(encoded.len());
            let has_more = end < encoded.len();
            let window = &encoded[offset..end];
            let cut = chunk_cut(window, "utf-8", 0, has_more);
            assert!(cut > 0, "window at {offset} must advance");
            rebuilt.push_str(std::str::from_utf8(&window[..cut]).unwrap());
            offset += cut;
        }
        assert_eq!(rebuilt, original);
    }
}
