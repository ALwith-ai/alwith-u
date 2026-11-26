use super::{accept_languages, browser_locale};

#[test]
fn the_chosen_language_wins_over_the_system() {
    assert_eq!(browser_locale(Some("en"), Some("zh-Hans-CN")), "en-US");
    assert_eq!(browser_locale(Some("zh-CN"), Some("en-US")), "zh-CN");
}

#[test]
fn a_system_tag_becomes_a_locale_chromium_ships() {
    for (system, locale) in [
        ("zh-Hans-CN", "zh-CN"),
        ("zh-Hant-HK", "zh-TW"),
        ("zh-TW", "zh-TW"),
        ("zh", "zh-CN"),
        ("en-GB", "en-GB"),
        ("en-AU", "en-GB"),
        ("en", "en-US"),
        ("pt-PT", "pt-PT"),
        ("pt", "pt-BR"),
        ("es-MX", "es-419"),
        ("es-ES", "es"),
        ("ja-JP", "ja"),
        ("fr_CA", "fr"),
        ("ar-SA", "ar"),
    ] {
        assert_eq!(browser_locale(None, Some(system)), locale, "{system}");
    }
    assert_eq!(browser_locale(None, None), "en-US");
}

#[test]
fn a_website_is_told_the_locale_and_its_language_without_a_script() {
    for (system, languages) in [
        ("zh-Hans-CN", "zh-CN,zh"),
        ("zh-Hant-HK", "zh-TW,zh"),
        ("en-AU", "en-GB,en"),
        ("es-MX", "es-419,es"),
        ("pt", "pt-BR,pt"),
        ("ja-JP", "ja"),
    ] {
        assert_eq!(accept_languages(&browser_locale(None, Some(system))), languages, "{system}");
    }
}
