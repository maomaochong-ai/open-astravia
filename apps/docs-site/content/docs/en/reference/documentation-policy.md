---
title: Documentation scope and versions
description: Explain the public documentation boundary and version policy.
---

## Public scope

This site publishes product usage, plugin development, and stable SDK contracts. The following are not public by default:

- Architecture decision records and unfinished proposals.
- Deployment topology, internal domains, and credential configuration.
- Telemetry implementation, incident reports, and internal validation records.
- Experimental features that are not stable yet.

## Version policy

The current documentation describes the latest released version. A page calls out a specific version when necessary. Until a long-lived compatibility branch is required, the site does not maintain multiple versioned documentation trees.

## Sources of truth

- User-visible entry points and copy follow the current Desktop routes, UI, and i18n resources.
- SDK, RPC, CLI, and configuration fields follow public package exports, type declarations, and executable parameters.
- `content/docs/` is the single source for public explanations; internal ADRs, implementation logs, and validation records are not published directly.
- Examples use public entry points and must not deep-import private `src/**` code just to make an example temporarily runnable.

Whenever a public behavior, configuration, permission, protocol, or entry point changes, review the corresponding area in `apps/docs-site/docs-coverage.json` and update the page or validation status.

## Content types

| Type | Question answered | Must include |
| --- | --- | --- |
| Quick start | How can I complete my first successful task quickly? | Prerequisites, minimum steps, expected result, next step |
| Guide | When should I use this capability and what are its boundaries? | Conditions, steps, verification, common recovery |
| Worked example | How does one complete task go from input to acceptance? | Starting state, copyable task, artifact, evidence, correction path |
| Reference | What exactly is the stable field, command, or contract? | Values, defaults, compatibility boundary, source of truth |

Placeholder paths, domains, and model IDs in examples must be clearly identified. Executable code must use public entry points. Link to deeper explanations instead of duplicating an entire reference contract in a quick start or example.

## Reporting a documentation issue

Include the page address, incorrect content, Vetta version, and expected behavior. Do not include access keys, personal data, or internal service addresses in an issue.
