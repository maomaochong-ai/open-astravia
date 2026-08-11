# @vetta/capability-sdk

Capability contracts and built-in system adapters for Vetta hosts.

The root exports stable capability tokens, IDs, input/output types, constraints, and error codes. Host-only adapters live under `internal/*` and are not re-exported from the package root. Plugin and Theme authors consume their system SDKs rather than this package.

Provider implementations and Electron integrations remain in the host. Access execution belongs to `@vetta/capability-runtime`.

Architecture references:

- [`docs/contracts-and-adapters.md`](docs/contracts-and-adapters.md) explains the contract/adapter dependency inversion and placement rules.
- [`docs/capabilities/README.md`](../../docs/capabilities/README.md) describes the cross-repository capability architecture.
