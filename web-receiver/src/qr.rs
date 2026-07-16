//! Renders receive links as SVG QR codes.
//!
//! Mirrors the desktop app's `render_ticket_qr` command (same `qrcode` crate,
//! same dimensions and colors) so a share scans identically whether it started
//! in the app or in a browser tab.

use qrcode::render::svg;
use qrcode::QrCode;

/// Renders `text` as an SVG QR code (256px minimum, high-contrast colors).
///
/// # Errors
///
/// Returns a message if the text is too long to fit in a QR code.
pub fn render_svg(text: &str) -> Result<String, String> {
    let code = QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code
        .render::<svg::Color<'_>>()
        .min_dimensions(256, 256)
        .dark_color(svg::Color("#0F172A"))
        .light_color(svg::Color("#FFFFFF"))
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_svg_with_app_matching_colors() {
        let svg = render_svg("https://example.com/receive#t=fd2:ABC").expect("qr should render");
        assert!(svg.contains("<svg"));
        assert!(svg.contains("#0F172A"));
        assert!(svg.contains("#FFFFFF"));
    }

    #[test]
    fn rejects_text_beyond_qr_capacity() {
        let too_long = "x".repeat(4000);
        assert!(render_svg(&too_long).is_err());
    }
}
