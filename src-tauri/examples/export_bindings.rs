fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Byte counts, revisions and timings retain their existing JS number representation.
    // Window coordinates are finite values supplied by the platform.
    let source = alwith_u_lib::bindings().typescript_with(tauri3_specta::ExportOptions {
        bigints_as_numbers: true,
        finite_floats: true,
        ..Default::default()
    })?;
    print!("{source}");
    Ok(())
}
