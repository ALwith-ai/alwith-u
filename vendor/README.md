# Local extension SDK package

`alwith-module-extension-0.1.0-rc.14.tgz` contains the Windows path serialization
and initialization recovery fixes from the sibling `alwith-modules` repository.
It is consumed as an npm tarball, including its Rust SDK, through `node_modules`.
The package has not been published to the registry.

To rebuild it from `alwith-modules/packages/extension`:

```powershell
bun run build
bun pm pack --ignore-scripts --destination ../../../alwith-u/vendor
```

Then run `bun install` in this repository and verify the lockfile integrity.
Replace the tarball dependency with the registry version after that same source
has been published and verified.
