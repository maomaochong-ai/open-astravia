# @vetta-org/plugin-cli

Install an npm-distributed plugin into the running Vetta Desktop app:

```bash
npx @vetta-org/plugin-cli add @example/vetta-plugin-demo
```

The npm package is fetched with lifecycle scripts disabled. The CLI extracts only the archive declared by
`package.json#vetta`, then asks the running Desktop host to validate, approve, and install it. It never writes
`~/.vetta/plugins` directly.

Local archives and HTTP(S) archives use the same command:

```bash
npx @vetta-org/plugin-cli add ./release/demo-1.0.0.zip
npx @vetta-org/plugin-cli add https://example.com/demo-1.0.0.zip
```

Use `--json` for machine-readable output. Set `VETTA_CONFIG_DIR` or `VETTA_HOME` when targeting an isolated
Desktop environment.

## Publisher contract

The published plugin package must include a standard Desktop plugin archive and declare it in `package.json`:

```json
{
  "name": "@example/vetta-plugin-demo",
  "version": "1.0.0",
  "files": ["release/vetta-plugin.zip"],
  "vetta": {
    "schemaVersion": 1,
    "type": "desktop-plugin",
    "pluginId": "demo",
    "archive": "release/vetta-plugin.zip"
  }
}
```

`@vetta-org/plugin-vite` can create both the versioned archive and this stable npm archive with
`package: { npmArchive: true }`.
