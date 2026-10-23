# Windows instance admission

Based on `tauri-plugin-single-instance` 3.0.0-alpha.3 (Apache-2.0 OR MIT).

Windows previously continued startup when the named mutex already existed but
the forwarding window was missing. Wait briefly for the first process to create
its receiver, then fail startup if it remains unavailable. Check mutex and
receiver creation failures instead of admitting an unprotected instance.

Other platforms and successful argument forwarding are unchanged. Remove this
patch when the upstream package enforces these same admission conditions.
