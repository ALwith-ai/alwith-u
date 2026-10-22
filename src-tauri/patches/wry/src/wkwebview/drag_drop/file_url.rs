use std::path::PathBuf;

use objc2_foundation::{NSString, NSURL};

pub(crate) fn resolve_file_url(value: &NSString) -> Option<PathBuf> {
  // Finder can supply file-reference URLs (/.file/id=...), which are not POSIX paths.
  // Resolve through Foundation before delivering paths to any native drop consumer.
  let url = NSURL::URLWithString(value)?;
  if !url.isFileURL() {
    return None;
  }
  let path = url.filePathURL()?.path()?;
  Some(PathBuf::from(path.to_string()))
}
