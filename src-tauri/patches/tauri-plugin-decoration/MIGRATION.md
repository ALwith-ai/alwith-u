# Tauri 3 adaptation

Source: https://github.com/oovz/tauri-plugin-decoration at
`235272b40d9a7b840ad49944e9fef334fde251ec`. The upstream MIT license and
source files are retained.

The local snapshot updates Tauri and its plugin build dependency to Tauri 3,
renames the plugin initialization-script API, rebinds the document lease after
navigation completes, and scopes the injected frontend
to the main window. The optional macOS transparency feature no longer requests
Tauri's removed private-API feature. The objc2 constraint permits the host's
existing 0.6 release.
ALwith U registers this plugin only on Windows and activates it only for the
main window. Other platforms retain their existing native decorations.
