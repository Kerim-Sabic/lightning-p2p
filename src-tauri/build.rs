fn main() {
    tauri_build::build();

    #[cfg(target_os = "windows")]
    embed_resource::compile_for_tests("tests/transfer-test.rc", embed_resource::NONE)
        .manifest_required()
        .expect("transfer test requires the Common Controls v6 activation manifest");
}
