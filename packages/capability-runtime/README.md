# @vetta/capability-runtime

Host-side capability registries, provider routing, exact Capability ID grants, access sessions, constraints, and audit hooks.

This package is system-agnostic. It must not import or branch on Plugin, Theme, Action, or other adapter semantics.

Architecture references:

- [`docs/registry-and-access.md`](docs/registry-and-access.md) explains Registry, Access, Provider, and host composition boundaries.
- [`docs/capabilities/README.md`](../../docs/capabilities/README.md) describes the cross-repository capability architecture.
