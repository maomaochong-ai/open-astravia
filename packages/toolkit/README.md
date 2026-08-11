# @vetta/toolkit

Monorepo-wide **Node utilities** — not product business logic.

Start with versioned JSON config + atomic file writes. More shared tools can land here later (path helpers, small algorithms, etc.).

## Install

```ts
// workspace
"@vetta/toolkit": "workspace:*"
```

## Modules

| Import | Purpose |
|--------|---------|
| `@vetta/toolkit` | All public APIs |
| `@vetta/toolkit/versioned-config` | Pure `schemaVersion` migration runner (no fs) |
| `@vetta/toolkit/config-store` | Versioned JSON file store (Node) |
| `@vetta/toolkit/atomic-write` | Atomic write file/JSON (Node) |

## Versioned config (any package)

```ts
import { migrateVersionedConfig } from "@vetta/toolkit/versioned-config";

const { config, migrated } = migrateVersionedConfig(raw, {
  currentVersion: 4,
  migrations: [
    { fromVersion: 1, toVersion: 2, migrate: (c) => ({ ...c, foo: 1 }) },
    // ...
  ],
});
```

## JSON store (Node only)

```ts
import { createVersionedJsonConfigStore } from "@vetta/toolkit/config-store";

const store = createVersionedJsonConfigStore<MyConfig>({
  path: "/path/to/config.json",
  name: "my-feature",
  normalize: normalizeMyConfig,
  migrate: migrateMyConfig,
  logger: console,
});

const config = await store.read();
await store.write(config);
```

Business schemas and migrations stay in the consuming package (e.g. desktop-app pet / app-monitor).

Detailed conventions and recommended consumer directory structure are documented in
[`docs/migrations.md`](docs/migrations.md).

## Design rules

- **No** Electron / desktop-app / theme dependencies.
- Prefer small, composable tools; domain config lives with the product.
- Mark Node-only APIs clearly (fs-backed modules).
