//! Voice credential input validation. Storage belongs to the application settings service.
pub(crate) fn validate(secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() || secret.len() > 4096 || secret.contains(['\r', '\n']) {
        return Err("invalid_voice_credential".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn rejects_empty_oversized_and_header_injection_credentials() {
        for value in ["".to_owned(), " ".into(), "a\nb".into(), "a\rb".into(), "a".repeat(4097)] {
            assert_eq!(super::validate(&value).unwrap_err(), "invalid_voice_credential");
        }
        assert!(super::validate("valid-test-key").is_ok());
    }
}
