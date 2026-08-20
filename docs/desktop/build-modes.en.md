# Build Modes and Environment Variables

*[中文](./build-modes.md)*

Vetta Desktop ships in two editions, selected by the build-time flag `VETTA_CLOUD_ENABLED`. An unconfigured development session remains serv-less, but **packaging requires an explicit `true` or `false`** so release builds never guess their edition.

| | **open-source (serv-less)** | **commercial (Vetta Serv)** |
| --- | --- | --- |
| Flag | `VETTA_CLOUD_ENABLED=false` | `VETTA_CLOUD_ENABLED=true` |
| Account login / OAuth | ❌ not in the bundle | ✅ |
| Vetta Go model channel | ❌ | ✅ |
| Subscription / credits / quota | ❌ | ✅ |
| Ability marketplace source | GitHub repository (built in) | official marketplace (Vetta Serv) |
| Remote model catalog | ❌ | ✅ |
| Built-in skills | those without `requiresCloud` | all |

**Available in both modes**: local sessions, the coding agent, the plugin system, themes, bring-your-own-key models, the IM gateway, and the knowledge base.

> The built-in GitHub marketplace source applies **to open-source builds only**. A commercial build uses the official marketplace served by Vetta Serv; setting `VETTA_OPEN_MARKETPLACE_REPOSITORY` there has no effect, because two channels offering the same ability would disagree on versions and installation state. Users of a commercial build can still add GitHub sources manually from the UI.

> `VETTA_CLOUD_ENABLED` is a **build-time** flag, inlined as a constant and folded away: in an open-source build the cloud module and its chunks are never bundled. **It cannot be re-enabled at runtime after shipping** — switching editions requires a rebuild.

---

## Building the open-source edition

Windows, macOS, and Linux use the same entry point. It selects the host platform and injects the complete open-source defaults: cloud disabled, the public marketplace, and updates from the `openvetta/open-vetta` GitHub Releases page.

```bash
cd apps/desktop
bun run dist:opensource
```

To create an unpacked directory for verification:

```bash
bun run dist:opensource -- --target dir
```

Forks can override GitHub and marketplace coordinates in `apps/desktop/.env.opensource`:

```bash
VETTA_UPDATE_GITHUB_OWNER=your-org
VETTA_UPDATE_GITHUB_REPO=your-fork
VETTA_OPEN_MARKETPLACE_REPOSITORY=your-org/your-marketplace
```

Open-source builds reject `VETTA_SERVER_URL` and `VETTA_SITE_URL`: login, the official marketplace, and the remote model catalog are absent from the bundle.

## Building the commercial edition

You need a running Vetta server:

```bash
# apps/desktop/.env.production (local file, not committed)
VETTA_CLOUD_ENABLED=true
VETTA_SERVER_URL=https://api.example.com/api/v1
VETTA_SITE_URL=https://www.example.com
```

Then run `bun run dist:desktop` (or `dist:win`, `dist:mac`, or `dist:linux`) from `apps/desktop`. Commercial builds default to the `generic` provider and the official stable update feed; self-hosted deployments should explicitly override `VETTA_UPDATE_URL`.

`VETTA_SERVER_URL` is required for commercial builds, and production builds require HTTPS. Missing or invalid settings fail before old output is cleaned, dependencies are downloaded, or compilation begins.

`VETTA_SITE_URL` is optional; it is derived from `VETTA_SERVER_URL` by stripping the `api.` prefix and mapping port `8080` to `3000`.

---

## Environment files

No `.env.*` file is tracked in git. `apps/desktop/.env.example` is the variable index — copy it to `.env.development` and edit.

When packaging, `VETTA_BUILD_ENV=<mode>` selects which `.env.<mode>` to load:

```bash
VETTA_BUILD_ENV=production bun run pack     # reads .env.production
bun run pack:test                           # same as VETTA_BUILD_ENV=test
```

Precedence: **inline on the command line > process environment > `.env.<mode>` > `.env` > code defaults**.

### Reference: a typical `.env.production`

This is what our team uses for official releases. Your production endpoint, update source and tenant are almost certainly different:

```bash
VETTA_CLOUD_ENABLED=true
VETTA_SERVER_URL=https://api.openvetta.com/api/v1
VETTA_SITE_URL=https://www.openvetta.com
VETTA_UPDATE_PROVIDER=generic
VETTA_UPDATE_URL=https://releases.openvetta.com/desktop/stable
VETTA_R2_BUCKET=vetta-releases
VETTA_R2_PREFIX=desktop/stable
VETTA_TENANT=common
VETTA_SPEECH_INPUT_ENABLED=false
```

### Reference: a typical `.env.test`

```bash
VETTA_CLOUD_ENABLED=true
VETTA_SERVER_URL=http://127.0.0.1:8080/api/v1
# The default provider is stable; override VETTA_UPDATE_URL for a dedicated test feed.
VETTA_UPDATE_PROVIDER=generic
VETTA_UPDATE_URL=https://releases.openvetta.com/desktop/test
```

---

## Variable reference

### Mode and service endpoints

| Variable | Description |
| --- | --- |
| `VETTA_CLOUD_ENABLED` | `false` produces open-source; `true` produces commercial; packaging requires an explicit value |
| `VETTA_SERVER_URL` | Server API endpoint. Required for commercial and forbidden in open-source builds |
| `VETTA_SITE_URL` | Site URL used for the OAuth login redirect. Derived from `VETTA_SERVER_URL` when unset |
| `VETTA_OPEN_MARKETPLACE_REPOSITORY` | Built-in GitHub marketplace source. **Required for open-source**; ignored in commercial |
| `VETTA_OPEN_MARKETPLACE_REF` | Branch or tag, defaults to `main` |
| `VETTA_OPEN_MARKETPLACE_ARCHIVE_URL` | Explicit archive URL; derived from repository and ref when omitted |

### Build-time trimming

| Variable | Description |
| --- | --- |
| `VETTA_SPEECH_INPUT_ENABLED` | `false` excludes the speech models, the Sherpa native runtime and the speech entry point. Enabled by default |
| `VETTA_TENANT` | System-plugin tenant, decides which presets get packaged. See `packages/plugins/tenants.json` |
| `VETTA_BUILD_ENV` | Selects which `.env.<mode>` to load |

### Development toggles

| Variable | Description |
| --- | --- |
| `VETTA_SHOW_UI_THEME` | `true` reveals the "UI theme" section in appearance settings |

### Auto-update

| Variable | Description |
| --- | --- |
| `VETTA_UPDATE_PROVIDER` | Commercial requires `generic` (the default); open-source requires `github` |
| `VETTA_UPDATE_URL` | For `generic`: R2, self-hosted object storage, or any static HTTP/CDN root |
| `VETTA_UPDATE_GITHUB_OWNER` · `VETTA_UPDATE_GITHUB_REPO` | For `github` |
| `VETTA_R2_BUCKET` · `VETTA_R2_PREFIX` | R2 upload target, used only by `publish:updates:r2` |

The update source is build configuration and is independent of the operating system; switching providers requires no client code changes. Platform details: [macOS](./macos-auto-update.md), [Windows](./windows-auto-update.md).

### Observability

| Variable | Description |
| --- | --- |
| `VETTA_SENTRY_DSN` | Sentry is a no-op when unset. The DSN ends up in the bundle |
| `VETTA_SENTRY_RELEASE` | Immutable release; must match exactly between runtime and source-map upload. Suggested: `vetta-desktop@<version>+<build-id>` |
| `VETTA_TELEMETRY_ENVIRONMENT` | `development` / `staging` / `production` |
| `VETTA_SENTRY_TRACES_SAMPLE_RATE` | 0–1, defaults to 0 |
| `VETTA_SENTRY_ORG` · `VETTA_SENTRY_PROJECT` · `VETTA_SENTRY_URL` | Source-map upload (CI only); `URL` is for self-hosted Sentry only |
| `VETTA_MAIN_SOURCEMAP` | Emit a main-process source map for local stack debugging without uploading |
| `VETTA_POSTHOG_KEY` | Project API Key (starts with `phc_`), **not** a Personal API Key. Ends up in the renderer bundle |
| `VETTA_POSTHOG_HOST` | Defaults to PostHog Cloud US |
| `VETTA_POSTHOG_REPLAY_ENABLED` · `VETTA_POSTHOG_REPLAY_SAMPLE_RATE` | Replay is off by default |
| `VETTA_TRACING` | Set to `langfuse` to trace agent / LLM / tool calls end to end |
| `VETTA_TRACING_TRACE_NAME` · `LANGFUSE_PUBLIC_KEY` · `LANGFUSE_BASE_URL` | Langfuse configuration |
| `LANGFUSE_TRACING_ENVIRONMENT` · `LANGFUSE_RELEASE` · `OTEL_SERVICE_NAME` | Optional metadata |

---

## Secrets

**Never put these in any `.env` file.** Inject them through the shell environment or CI secrets:

- **Cloudflare R2 upload credentials**: `VETTA_R2_ACCOUNT_ID`, `VETTA_R2_ACCESS_KEY_ID`, `VETTA_R2_SECRET_ACCESS_KEY`
- **macOS signing and notarization**: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_API_*`
  CI variants: `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
  Set none of them and you get an unsigned package; to sign, all of them are required. See [apple-code-signing.md](../deploy/apple-code-signing.md)
- **Sentry source-map upload**: `VETTA_SENTRY_AUTH_TOKEN`
- **Langfuse**: `LANGFUSE_SECRET_KEY`

`VETTA_REQUIRE_MAC_SIGNATURE=1` is only used by the macOS CI artifact verification step; it is not client configuration.

---

## CI

`.github/workflows/desktop-release.yml` resolves build configuration in the `prepare` job, which uses the `desktop-production` Environment. Precedence:

1. **Actions → desktop-release → Run workflow form** (`workflow_dispatch` only; `default` / empty means no override)
2. **Environment / repository Variables** (when the job sets `environment: desktop-production`, Environment values overlay same-named repository variables)
3. Built-in defaults: `VETTA_RELEASE_TARGET=github` selects open-source; `r2` selects commercial

**A fork with no Variables set produces an open-source build.** For an official commercial build, put these on Settings → Environments → `desktop-production` → Environment variables (credentials stay in Environment secrets):

```
VETTA_CLOUD_ENABLED = true
VETTA_SERVER_URL    = https://api.example.com/api/v1
VETTA_SITE_URL      = https://www.example.com
VETTA_RELEASE_TARGET = r2
VETTA_UPDATE_URL     = https://releases.example.com/desktop/stable
VETTA_R2_BUCKET      = vetta-releases
VETTA_R2_PREFIX      = desktop/stable
```

Optional: `VETTA_UPDATE_URL_TEST` / `VETTA_R2_PREFIX_TEST` (and `_STABLE`). Choosing channel `test` on a manual run prefers those; otherwise a trailing `stable` / `test` / `beta` / `prod` / `production` segment is rewritten.

The form can override the edition, server URLs, tenant, speech input, publish target, and channel. GitHub + open-source and R2 + commercial must stay paired. **Do not type R2 keys, certificates, or DSNs into the form** — those stay in Secrets.

`workflow_dispatch` only builds and keeps an Actions artifact, and prints the resolved config on the job summary. Only a release tag matching the `package.json` version publishes to R2 / GitHub Releases. The form is visible only after this workflow exists on the repository default branch.
