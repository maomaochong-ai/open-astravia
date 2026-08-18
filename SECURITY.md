# Security Policy

## Supported versions

This repository is the Open Vetta client. Security fixes land on the `dev` branch and ship with the next desktop release. We do not maintain long-lived patched release lines.

## Reporting a vulnerability

**Do not open a public GitHub issue** for a security report.

Use [GitHub Private Vulnerability Reporting](https://github.com/openvetta/open-vetta/security/advisories/new) so only maintainers see the details.

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept that does **not** include real user data
- Affected version (Settings → General, or `apps/desktop/package.json` for a source build)
- Whether the issue is in the lite (source) build, an official installer, a plugin, or the IM gateway

Do **not** attach API keys, tokens, cookies, session files, or production configuration.

We will acknowledge a valid report and follow up on the advisory. Please give us a reasonable window to ship a fix before any public disclosure.

## Scope

In scope for this repository:

- The desktop app, CLI host, IM gateway, and docs site in this monorepo
- Plugin / theme / skill loading and permission checks in this client
- Credential storage and the network behavior documented in the README

Out of scope here (do not send to this advisory):

- Vetta Serv (accounts, billing, hosted marketplace) — that is a separate private repository
- Vulnerabilities that exist only in a third-party model provider, MCP server, or user-installed plugin, unless this client fails to enforce a declared permission or ships the vulnerable code

Product privacy and outbound network behavior are summarized in the README [Network Behavior](README.md#network-behavior) section and in [docs.openvetta.com](https://docs.openvetta.com/reference/security-and-data/).
