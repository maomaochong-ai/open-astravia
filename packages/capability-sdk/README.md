# @astravia-org/capability-sdk

Host- and system-neutral capability contracts for Astravia.

The package exports stable capability tokens, IDs, input/output types, constraints, grants, session contracts, and error codes. Plugin, Theme, Action, and host-specific adapters live with their owning upper layer and depend on this package; this package does not depend on or expose them.

Provider implementations and Electron integrations remain in the host. Access execution belongs to `@astravia/capability-runtime`.

Architecture references:

- [`docs/contracts-and-host-integration.md`](docs/contracts-and-host-integration.md) explains the contract and host integration boundaries.
- [`docs/capabilities/README.md`](../../docs/capabilities/README.md) describes the cross-repository capability architecture.
