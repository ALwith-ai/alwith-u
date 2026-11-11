//! One send-copy policy for preview edits and provider references. Originals are never overwritten.
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageFormat, ImageReader, imageops::FilterType};
use std::io::Cursor;

const ACP_MESSAGE_BYTES: usize = 32 * 1024 * 1024;
// Leave room for ACP/Runtime envelopes and the adapter's per-turn instructions.
const ENVELOPE_BYTES: usize = 64 * 1024;
const SEEDREAM_IMAGE_BYTES: usize = 30_000_000;
const SEEDREAM_IMAGE_PIXELS: u64 = 36_000_000;
const CHATGPT_REFERENCE_BYTES: usize = 12 * 1024 * 1024;

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageReferencesInput {
    pub model: Option<String>,
    pub images: Vec<String>,
    pub envelope_bytes: usize,
}

struct Limits {
    encoded_bytes: usize,
    image_bytes: usize,
    pixels: u64,
    min_side: u32,
    max_side: u32,
}

impl Limits {
    fn for_request(model: Option<&str>, count: usize, envelope_bytes: usize) -> Result<Self, String> {
        let mut limits = Self {
            encoded_bytes: ACP_MESSAGE_BYTES
                .checked_sub(ENVELOPE_BYTES)
                .and_then(|remaining| remaining.checked_sub(envelope_bytes))
                .filter(|remaining| *remaining > 2)
                .ok_or("Image instructions exceed the ACP message budget")?,
            image_bytes: usize::MAX,
            pixels: u64::MAX,
            min_side: 1,
            max_side: u32::MAX,
        };
        match model {
            None => {}
            Some("wham") => {
                if count > 16 {
                    return Err("This image model supports at most 16 references".into());
                }
                // This adapter endpoint still has its own reference-body budget.
                limits.encoded_bytes = limits.encoded_bytes.min(CHATGPT_REFERENCE_BYTES);
            }
            Some(model) => {
                let (_, maximum, _) = super::model_limits(model)?;
                if count > maximum {
                    return Err(format!("This image model supports at most {maximum} references"));
                }
                if matches!(super::model_provider(model)?, super::ImageProvider::Minimax) {
                    limits.image_bytes = 64 * 1024 * 1024;
                    limits.min_side = 128;
                    limits.max_side = 8192;
                    return Ok(limits);
                }
                limits.image_bytes = SEEDREAM_IMAGE_BYTES;
                limits.pixels = SEEDREAM_IMAGE_PIXELS;
                limits.min_side = 15;
            }
        }
        Ok(limits)
    }
}

struct Reference {
    url: String,
    bytes: Vec<u8>,
    format: ImageFormat,
    width: u32,
    height: u32,
}

impl Reference {
    fn read(url: String, limits: &Limits) -> Result<Self, String> {
        let (header, data) = url.split_once(',').ok_or("Invalid reference image")?;
        let format = match header {
            "data:image/png;base64" => ImageFormat::Png,
            "data:image/jpeg;base64" => ImageFormat::Jpeg,
            "data:image/webp;base64" => ImageFormat::WebP,
            _ => return Err("Unsupported reference image format".into()),
        };
        let bytes = STANDARD.decode(data).map_err(|_| "Invalid reference image encoding")?;
        if image::guess_format(&bytes).map_err(|_| "Invalid reference image")? != format {
            return Err("Reference image format does not match its media type".into());
        }
        let (width, height) = ImageReader::with_format(Cursor::new(&bytes), format)
            .into_dimensions()
            .map_err(|_| "Invalid reference image dimensions")?;
        if width < limits.min_side || height < limits.min_side {
            return Err(format!("Reference image dimensions must be at least {} pixels", limits.min_side));
        }
        if limits.min_side == 15
            && (u64::from(width) > u64::from(height) * 16 || u64::from(height) > u64::from(width) * 16)
        {
            return Err("Seedream reference aspect ratios must be between 1:16 and 16:1".into());
        }
        if limits.min_side == 128 && (width > height.saturating_mul(4) || height > width.saturating_mul(4)) {
            return Err("MiniMax reference aspect ratios must be between 1:4 and 4:1".into());
        }
        Ok(Self { url, bytes, format, width, height })
    }

    fn within_service_limits(&self, limits: &Limits) -> bool {
        self.width <= limits.max_side
            && self.height <= limits.max_side
            && self.bytes.len() <= limits.image_bytes
            && u64::from(self.width) * u64::from(self.height) <= limits.pixels
    }

    fn compress(&mut self, target: usize, limits: &Limits, keep_readable: bool) -> Result<(), String> {
        let image = ImageReader::with_format(Cursor::new(&self.bytes), self.format)
            .decode()
            .map_err(|_| "Cannot decode the reference image for a smaller send copy")?;
        let minimum = f64::from(limits.min_side) / f64::from(self.width.min(self.height));
        // Reduce secondary references first without making numbered pins illegible.
        let floor = if keep_readable {
            (1024.0 / f64::from(self.width.max(self.height))).min(1.0).max(minimum)
        } else {
            minimum
        };
        let mut scale = ((limits.pixels as f64 / (f64::from(self.width) * f64::from(self.height))).sqrt()).min(1.0);
        scale = scale.min(f64::from(limits.max_side) / f64::from(self.width.max(self.height)));
        loop {
            let width = ((f64::from(self.width) * scale).floor() as u32).max(limits.min_side);
            let height = ((f64::from(self.height) * scale).floor() as u32).max(limits.min_side);
            let resized;
            let copy = if width == self.width && height == self.height {
                &image
            } else {
                resized = image.resize_exact(width, height, FilterType::Lanczos3);
                &resized
            };
            let candidate = Self::lossless_copy(copy)?;
            let within_service = candidate.within_service_limits(limits);
            if within_service && (candidate.url.len() <= target || scale <= floor) {
                if candidate.url.len() < self.url.len() || !self.within_service_limits(limits) {
                    *self = candidate;
                }
                return Ok(());
            }
            if scale <= minimum {
                return Err("Reference images cannot fit the image request budget".into());
            }
            let reduction = ((target as f64 / candidate.url.len() as f64).sqrt() * 0.95).clamp(0.2, 0.85);
            let next = scale * reduction;
            scale = next.max(if within_service { floor } else { minimum });
        }
    }

    fn lossless_copy(image: &DynamicImage) -> Result<Self, String> {
        let mut bytes = Cursor::new(Vec::new());
        // WebP's dimension limit is smaller than some valid Seedream reference images.
        let (format, mime) = if image.width().max(image.height()) <= 16383 {
            (ImageFormat::WebP, "image/webp")
        } else {
            (ImageFormat::Png, "image/png")
        };
        // Both encoders retain alpha; WebP encoding is lossless. Never flatten to JPEG.
        image.write_to(&mut bytes, format).map_err(|_| "Cannot encode the image send copy")?;
        let bytes = bytes.into_inner();
        Ok(Self {
            url: format!("data:{mime};base64,{}", STANDARD.encode(&bytes)),
            bytes,
            format,
            width: image.width(),
            height: image.height(),
        })
    }
}

fn encoded_size(images: &[Reference]) -> usize {
    // JSON array punctuation and quotes, in addition to the Base64 data URLs.
    2 + images.iter().map(|image| image.url.len() + 3).sum::<usize>() - usize::from(!images.is_empty())
}

pub(super) fn prepare(input: ImageReferencesInput) -> Result<Vec<String>, String> {
    let limits = Limits::for_request(input.model.as_deref(), input.images.len(), input.envelope_bytes)?;
    let mut images =
        input.images.into_iter().map(|url| Reference::read(url, &limits)).collect::<Result<Vec<_>, _>>()?;
    for image in images.iter_mut().rev() {
        if !image.within_service_limits(&limits) {
            image.compress(limits.encoded_bytes.saturating_sub(4), &limits, false)?;
        }
    }
    // Original first, annotation/mask second: spend the original's quality budget last.
    for keep_readable in [true, false] {
        for index in (0..images.len()).rev() {
            let excess = encoded_size(&images).saturating_sub(limits.encoded_bytes);
            if excess == 0 {
                return Ok(images.into_iter().map(|image| image.url).collect());
            }
            let target = images[index].url.len().saturating_sub(excess);
            images[index].compress(target, &limits, keep_readable)?;
        }
    }
    if encoded_size(&images) > limits.encoded_bytes {
        return Err("Reference images cannot fit the image request budget".into());
    }
    Ok(images.into_iter().map(|image| image.url).collect())
}

#[cfg(test)]
#[path = "__tests__/references.rs"]
mod tests;
