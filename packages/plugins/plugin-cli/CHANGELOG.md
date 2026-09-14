# Changelog

All notable changes to `@vetta-org/plugin-cli` are documented in this file.

## [0.1.1] — 2026-09-14

### Fixed

- `sync` no longer writes `config.api_version` / `config.permissions` / `config.commands` into the index. The host overwrites the whole `config` with values derived from `plugin.json` when it builds the catalog, so a copy in the index is unread, drift-prone noise; a copy that already disagrees with the package is now reported instead.
- `sync` resolves bundle members, so their directories are no longer reported as unlisted abilities. The index's `abilities` array holds independently listed entries; bundle members deliberately stay out of it and carry their metadata in the package's own `ability.json`.
- Command examples now use the full package name wherever the command runs before `npm install` or at a repository root, where the `vetta-plugin-cli` bin is not on `node_modules/.bin` and npx would resolve it as a package name.

## [Unreleased]

### Added

- Added `vetta-plugin-cli init --id <plugin-id>`: scaffolds a buildable plugin project together with an `AGENTS.md` brief, so any coding agent can bootstrap in an unfamiliar directory without host-side knowledge. Inside a marketplace hub (`.vetta/marketplace.json`) the new plugin is also listed there, with a repository-relative `source.path`.
- Added `vetta-plugin-cli docs`: prints the absolute path of the manual shipped inside the installed `@vetta-org/plugin-sdk`, plus the SDK version it documents and the plugin/hub the command resolved. Nobody has to hard-code a `node_modules` path that workspace hoisting can move.
- Added `vetta-plugin-cli init hub`: scaffolds a conformant ability marketplace repository — index skeleton, `abilities/{plugins,mcp,skills,scenes}/`, a repository-level `AGENTS.md`, and a CI workflow that runs `sync --check`.
- Added `vetta-plugin-cli sync` (and `--check` for CI): reconciles a marketplace repository's `.vetta/marketplace.json` against each ability directory — version, api version, permissions and commands are pulled from the packages, missing build output and slug mismatches are reported, and `marketplaceVersion` is advanced so clients actually pick the update up. Ability directories that are not listed are reported, never added. `docs` and `add .` now point at it the moment it becomes relevant.
- Added `vetta-plugin-cli uninstall [plugin-id]`: removes a plugin through the Desktop approval path, inferring the target from the current directory when no id is given.
- Added `vetta-plugin-cli watch` (and `--stop`): asks the running Desktop to load the nearest plugin from its project directory, so source edits take effect without a build → pack → install round trip.
- `add` now accepts a plugin project directory (`add .`) and resolves the archive that project packed, instead of treating the directory as an archive path.

- Added `npx @vetta-org/plugin-cli add <npm-package>` with script-free npm resolution, package-envelope validation, archive integrity binding, and installation through the running Vetta Desktop Action RPC.
- Added `vetta-plugin-cli reload <plugin-id>` so pending plugin updates can be applied through the Desktop approval and lifecycle path.
