# Changelog

All notable changes to `@vetta-org/plugin-cli` are documented in this file.

## [Unreleased]

### Added

- Added `vetta-plugin-cli init --id <plugin-id>`: scaffolds a buildable plugin project together with an `AGENTS.md` brief, so any coding agent can bootstrap in an unfamiliar directory without host-side knowledge. Inside a marketplace hub (`.vetta/marketplace.json`) the new plugin is also listed there, with a repository-relative `source.path`.
- Added `vetta-plugin-cli docs`: prints the absolute path of the manual shipped inside the installed `@vetta-org/plugin-sdk`, plus the SDK version it documents and the plugin/hub the command resolved. Nobody has to hard-code a `node_modules` path that workspace hoisting can move.
- `add` now accepts a plugin project directory (`add .`) and resolves the archive that project packed, instead of treating the directory as an archive path.

- Added `npx @vetta-org/plugin-cli add <npm-package>` with script-free npm resolution, package-envelope validation, archive integrity binding, and installation through the running Vetta Desktop Action RPC.
- Added `vetta-plugin-cli reload <plugin-id>` so pending plugin updates can be applied through the Desktop approval and lifecycle path.
