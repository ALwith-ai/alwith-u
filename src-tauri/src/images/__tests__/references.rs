use super::*;
use image::{Rgba, RgbaImage};

const PRO: &str = "doubao-seedream-5-0-pro-260628";

fn png(image: RgbaImage, padded_bytes: usize) -> String {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image).write_to(&mut bytes, ImageFormat::Png).unwrap();
    let mut bytes = bytes.into_inner();
    bytes.resize(bytes.len().max(padded_bytes), 0);
    format!("data:image/png;base64,{}", STANDARD.encode(&bytes))
}

fn transparent(width: u32, height: u32) -> RgbaImage {
    RgbaImage::from_fn(width, height, |x, y| Rgba([200, 70, 40, ((x + y) % 3 * 127) as u8]))
}

fn input(images: Vec<String>) -> ImageReferencesInput {
    ImageReferencesInput { model: Some(PRO.into()), images, envelope_bytes: 4096 }
}

#[test]
fn originals_above_the_old_five_and_twelve_megabyte_limits_remain_byte_identical() {
    let source = png(transparent(16, 16), 6_000_001);
    let reference = png(transparent(16, 16), 13 * 1024 * 1024);
    let images = vec![source, reference];
    assert_eq!(prepare(input(images.clone())).unwrap(), images);
}

#[test]
fn an_over_budget_reference_is_compressed_before_the_original() {
    let source = png(transparent(16, 16), 6_000_001);
    let reference = png(transparent(32, 32), 22 * 1024 * 1024);
    let original_reference = reference.clone();
    let result = prepare(input(vec![source.clone(), reference])).unwrap();
    assert_eq!(result[0], source);
    assert_ne!(result[1], original_reference);
    assert!(serde_json::to_vec(&result).unwrap().len() + ENVELOPE_BYTES + 4096 <= ACP_MESSAGE_BYTES);
    let reference = Reference::read(result[1].clone(), &Limits::for_request(Some(PRO), 2, 4096).unwrap()).unwrap();
    let decoded = image::load_from_memory(&reference.bytes).unwrap().to_rgba8();
    assert_eq!(decoded, transparent(32, 32));
}

#[test]
fn service_byte_limits_also_create_a_copy_without_changing_alpha() {
    let source = png(transparent(16, 16), SEEDREAM_IMAGE_BYTES + 1);
    let original = source.clone();
    let result = prepare(input(vec![source])).unwrap();
    assert_ne!(result[0], original);
    let reference = Reference::read(result[0].clone(), &Limits::for_request(Some(PRO), 1, 4096).unwrap()).unwrap();
    assert_eq!(image::load_from_memory(&reference.bytes).unwrap().to_rgba8(), transparent(16, 16));
}

#[test]
fn when_reencoding_is_insufficient_send_copies_shrink_and_retain_transparency() {
    let source = png(
        RgbaImage::from_fn(128, 128, |x, y| {
            let noise = x.wrapping_mul(1664525).wrapping_add(y.wrapping_mul(1013904223));
            Rgba([(noise >> 16) as u8, (noise >> 8) as u8, noise as u8, if x < 32 { 0 } else { 255 }])
        }),
        0,
    );
    let original = source.clone();
    let mut request = input(vec![source.clone(), source]);
    request.envelope_bytes = ACP_MESSAGE_BYTES - ENVELOPE_BYTES - 4096;
    let result = prepare(request).unwrap();
    assert!(serde_json::to_vec(&result).unwrap().len() <= 4096);
    for url in result {
        assert_ne!(url, original);
        let reference = Reference::read(url, &Limits::for_request(Some(PRO), 2, 0).unwrap()).unwrap();
        assert!(reference.width < 128 && reference.height < 128);
        let pixels = image::load_from_memory(&reference.bytes).unwrap().to_rgba8();
        assert!(pixels.pixels().any(|pixel| pixel[3] == 0));
        assert!(pixels.pixels().any(|pixel| pixel[3] == 255));
    }
}

#[test]
fn image_pixels_count_as_area_and_the_service_aspect_and_reference_limits_are_enforced() {
    let limits = Limits::for_request(Some(PRO), 1, 0).unwrap();
    let mut image = Reference::read(png(transparent(16, 16), 0), &limits).unwrap();
    image.width = 7200;
    image.height = 5000;
    assert!(image.within_service_limits(&limits));
    image.width += 1;
    assert!(!image.within_service_limits(&limits));
    assert!(prepare(input(vec![png(transparent(16, 256), 0)])).is_ok());
    assert!(prepare(input(vec![png(transparent(16, 257), 0)])).is_err());
    assert!(prepare(input(vec![png(transparent(14, 14), 0)])).is_err());
    let tiny = png(transparent(1, 1), 0);
    assert_eq!(
        prepare(ImageReferencesInput { model: None, images: vec![tiny.clone()], envelope_bytes: 0 }).unwrap(),
        vec![tiny]
    );
    assert!(Limits::for_request(Some(PRO), 11, 0).is_err());
    assert!(Limits::for_request(Some("doubao-seedream-5-0-lite-260128"), 14, 0).is_ok());
    assert!(Limits::for_request(Some("doubao-seedream-5-0-lite-260128"), 15, 0).is_err());
}

#[test]
fn provider_selection_and_the_complete_message_budget_are_checked() {
    assert!(Limits::for_request(Some("invented"), 0, 0).is_err());
    assert!(Limits::for_request(None, 1, ACP_MESSAGE_BYTES).is_err());
    let source = png(transparent(16, 16), 0);
    assert!(prepare(input(vec![source.replace("image/png", "image/jpeg")])).is_err());
    assert!(prepare(input(vec!["https://example.com/image.png".into()])).is_err());
    let mut request = input(vec![png(transparent(16, 16), 0)]);
    request.envelope_bytes = ACP_MESSAGE_BYTES - ENVELOPE_BYTES - 16;
    assert!(prepare(request).is_err());
    let chatgpt = Limits::for_request(Some("wham"), 2, 0).unwrap();
    assert_eq!(chatgpt.encoded_bytes, CHATGPT_REFERENCE_BYTES);
}

#[test]
fn minimax_checks_reference_count_dimensions_and_ratio_without_changing_valid_originals() {
    for model in ["MiniMax-H3-Image", "MiniMax-H3-Image-Highspeed"] {
        assert!(Limits::for_request(Some(model), 16, 0).is_ok());
        assert!(Limits::for_request(Some(model), 17, 0).is_err());
        let limits = Limits::for_request(Some(model), 1, 0).unwrap();
        assert!(Reference::read(png(transparent(127, 128), 0), &limits).is_err());
        assert!(Reference::read(png(transparent(128, 513), 0), &limits).is_err());
        let source = png(transparent(128, 512), 0);
        assert_eq!(
            prepare(ImageReferencesInput {
                model: Some(model.into()),
                images: vec![source.clone()],
                envelope_bytes: 0
            })
            .unwrap(),
            vec![source]
        );
        let mut reference = Reference::read(png(transparent(128, 128), 0), &limits).unwrap();
        reference.width = 8193;
        assert!(!reference.within_service_limits(&limits));
    }
}
