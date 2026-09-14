# Changelog

All notable changes to `@vetta-org/plugin-cli` are documented in this file.

## [Unreleased]

### Added

- Added `vetta-plugin-cli init --id <plugin-id>`: scaffolds a buildable plugin project together with an `AGENTS.md` brief, so any coding agent can bootstrap in an unfamiliar directory without host-side knowledge. Inside a marketplace hub (`.vetta/marketplace.json`) the new plugin is also listed there, with a repository-relative `source.path`.
- Added `vetta-plugin-cli docs`: prints the absolute path of the manual shipped inside the installed `@vetta-org/plugin-sdk`, plus the SDK version it documents and the plugin/hub the command resolved. Nobody has to hard-code a `node_modules` path that workspace hoisting can move.
- Added `vetta-plugin-cli sync` (and `--check` for CI): reconciles a marketplace repository's `.vetta/marketplace.json` against each ability directory — version, api version, permissions and commands are pulled from the packages, missing build output and slug mismatches are reported, and `marketplaceVersion` is advanced so clients actually pick the update up. Ability directories that are not listed are reported, never added. `docs` and `add .` now point at it the moment it becomes relevant.
- Added `vetta-plugin-cli uninstall [plugin-id]`: removes a plugin through the Desktop approval path, inferring the target from the current directory when no id is given.
- Added `vetta-plugin-cli watch` (and `--stop`): asks the running Desktop to load the nearest plugin from its project directory, so source edits take effect without a build → pack → install round trip.
- `add` now accepts a plugin project directory (`add .`) and resolves the archive that project packed, instead of treating the directory as an archive path.

- Added `npx @vetta-org/plugin-cli add <npm-package>` with script-free npm resolution, package-envelope validation, archive integrity binding, and installation through the running Vetta Desktop Action RPC.
- Added `vetta-plugin-cli reload <plugin-id>` so pending plugin updates can be applied through the Desktop approval and lifecycle path.
