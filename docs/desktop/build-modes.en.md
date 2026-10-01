# Build Modes and Environment Variables

*[中文](./build-modes.md)*

Astravia Desktop ships in two editions, selected by the build-time flag `ASTRAVIA_CLOUD_ENABLED`. An unconfigured development session remains serv-less, but **packaging requires an explicit `true` or `false`** so release builds never guess their edition.

| | **open-source (serv-less)** | **commercial (Astravia Serv)** |
| --- | --- | --- |
| Flag | `ASTRAVIA_CLOUD_ENABLED=false` | `ASTRAVIA_CLOUD_ENABLED=true` |
| Account login / OAuth | ❌ not in the bundle | ✅ |
| Astravia Go model channel | ❌ | ✅ |
| Subscription / credits / quota | ❌ | ✅ |
| Ability marketplace source | Multiple GitHub sources (environment-configured or user-added) | Cloud marketplace (Astravia Serv); optional GitHub sources |
| Remote model catalog | ❌ | ✅ |
| Built-in skills | those without `requiresCloud` | all |

**Available in both modes**: local sessions, the coding agent, the plugin system, themes, bring-your-own-key models, the IM gateway, and the knowledge base.

Cloud and GitHub sources are independent: `ASTRAVIA_CLOUD_ENABLED` controls cloud services only.
Commercial builds do not include a GitHub repository by default. In either edition, a built-in source is registered
only when `ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY` is explicitly configured. Unset, empty, or whitespace-only means
no registration; there is no hard-coded repository fallback. Open-source distributions can configure the official
repository through the same environment variable.
Under Abilities → Marketplace sources, users can add multiple GitHub repositories and independently enable,
auto-update, or refresh each source. A failing source does not block others. Same-name abilities retain their
source identities; physical installation conflicts still require explicit resolution instead of silent overwrites.

`ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY` optionally declares the distribution's built-in source.
Removing it does not delete persisted sources or uninstall abilities; existing sources can be disabled in the UI.
Adding sources through the UI does not require rebuilding. Normally omit `ASTRAVIA_OPEN_MARKETPLACE_ARCHIVE_URL`
so it follows the repository and ref. Restart development processes after editing environment files;
subsequent repository content changes only require Refresh. A GitHub commit does not publish to the Astravia Serv
marketplace. See [GitHub marketplace format](../open-marketplace.md) for source and upgrade semantics.

> `ASTRAVIA_CLOUD_ENABLED` is a **build-time** flag, inlined as a constant and folded away: in an open-source build the cloud module and its chunks are never bundled. **It cannot be re-enabled at runtime after shipping** — switching editions requires a rebuild.

---

## Building the open-source edition

Windows, macOS, and Linux use the same entry point. It selects the host platform, disables cloud, and uses updates from the `maomaochong-ai/open-astravia` GitHub Releases page. GitHub ability sources come only from environment configuration, not script defaults.

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
ASTRAVIA_UPDATE_GITHUB_OWNER=your-org
ASTRAVIA_UPDATE_GITHUB_REPO=your-fork
ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY=your-org/your-marketplace
```

Open-source builds reject `ASTRAVIA_SERVER_URL` and `ASTRAVIA_SITE_URL`: login, the official marketplace, and the remote model catalog are absent from the bundle.

## Building the commercial edition

You need a running Astravia server:

```bash
# apps/desktop/.env.production (local file, not committed)
ASTRAVIA_CLOUD_ENABLED=true
ASTRAVIA_SERVER_URL=https://api.example.com/api/v1
ASTRAVIA_SITE_URL=https://www.example.com
```

Then run `bun run dist:desktop` (or `dist:win`, `dist:mac`, or `dist:linux`) from `apps/desktop`. Commercial builds default to the `generic` provider and the official stable update feed; self-hosted deployments should explicitly override `ASTRAVIA_UPDATE_URL`.

On Linux, `bun run package:linux` builds AppImage, DEB, and RPM together. Use `package:linux:appimage`, `package:linux:deb`, `package:linux:rpm`, or `package:linux:tar.gz` to build one format; append `:test` to the same command to use the test build environment.

On Windows, `bun run package:win` builds Inno, MSI, and ZIP together. Use `package:win:inno`, `package:win:msi`, `package:win:zip`, or `package:win:portable` to build one format; each command also has a `:test` variant. The updater manifest continues to reference only Inno; MSI and ZIP are supplemental downloads.

`ASTRAVIA_SERVER_URL` is required for commercial builds, and production builds require HTTPS. Missing or invalid settings fail before old output is cleaned, dependencies are downloaded, or compilation begins.

`ASTRAVIA_SITE_URL` is optional; it is derived from `ASTRAVIA_SERVER_URL` by stripping the `api.` prefix and mapping port `8080` to `3000`.

---

## Environment files

No `.env.*` file is tracked in git. `apps/desktop/.env.example` is the variable index — copy it to `.env.development` and edit.

When packaging, `ASTRAVIA_BUILD_ENV=<mode>` selects which `.env.<mode>` to load:

```bash
ASTRAVIA_BUILD_ENV=production bun run pack     # reads .env.production
bun run pack:test                           # same as ASTRAVIA_BUILD_ENV=test
```

Precedence: **inline on the command line > process environment > `.env.<mode>` > `.env` > code defaults**.

### Reference: a typical `.env.production`

This is what our team uses for official releases. Your production endpoint, update source and tenant are almost certainly different:

```bash
ASTRAVIA_CLOUD_ENABLED=true
ASTRAVIA_SERVER_URL=https://api.astravia.dev/api/v1
ASTRAVIA_SITE_URL=https://www.astravia.dev
ASTRAVIA_UPDATE_PROVIDER=generic
ASTRAVIA_UPDATE_URL=https://releases.astravia.dev/desktop/stable
ASTRAVIA_R2_BUCKET=astravia-releases
ASTRAVIA_R2_PREFIX=desktop/stable
ASTRAVIA_TENANT=common
ASTRAVIA_SPEECH_INPUT_ENABLED=false
```

### Reference: a typical `.env.test`

```bash
ASTRAVIA_CLOUD_ENABLED=true
ASTRAVIA_SERVER_URL=http://127.0.0.1:8080/api/v1
# The default provider is stable; override ASTRAVIA_UPDATE_URL for a dedicated test feed.
ASTRAVIA_UPDATE_PROVIDER=generic
ASTRAVIA_UPDATE_URL=https://releases.astravia.dev/desktop/test
```

---

## Variable reference

### Mode and service endpoints

| Variable | Description |
| --- | --- |
| `ASTRAVIA_CLOUD_ENABLED` | `false` produces open-source; `true` produces commercial; packaging requires an explicit value |
| `ASTRAVIA_SERVER_URL` | Server API endpoint. Required for commercial and forbidden in open-source builds |
| `ASTRAVIA_SITE_URL` | Site URL used for the OAuth login redirect. Derived from `ASTRAVIA_SERVER_URL` when unset |
| `ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY` | Optional built-in GitHub source for either edition; empty means no registration, with no default repository address |
| `ASTRAVIA_OPEN_MARKETPLACE_REF` | Branch or tag, defaults to `main` |
| `ASTRAVIA_OPEN_MARKETPLACE_ARCHIVE_URL` | Explicit archive URL; derived from repository and ref when omitted |

### Build-time trimming

| Variable | Description |
| --- | --- |
| `ASTRAVIA_SPEECH_INPUT_ENABLED` | `false` excludes the speech models, the Sherpa native runtime and the speech entry point. Enabled by default |
| `ASTRAVIA_TENANT` | System-plugin tenant, decides which presets get packaged. See `packages/plugins/tenants.json` |
| `ASTRAVIA_BUILD_ENV` | Selects which `.env.<mode>` to load |

### Development toggles

| Variable | Description |
| --- | --- |
| `ASTRAVIA_SHOW_UI_THEME` | `true` reveals the "UI theme" section in appearance settings |

### Auto-update

| Variable | Description |
| --- | --- |
| `ASTRAVIA_UPDATE_PROVIDER` | Commercial requires `generic` (the default); open-source requires `github` |
| `ASTRAVIA_UPDATE_URL` | For `generic`: R2, self-hosted object storage, or any static HTTP/CDN root |
| `ASTRAVIA_UPDATE_GITHUB_OWNER` · `ASTRAVIA_UPDATE_GITHUB_REPO` | For `github` |
| `ASTRAVIA_R2_BUCKET` · `ASTRAVIA_R2_PREFIX` | R2 upload target, used only by `publish:updates:r2` |

The update source is build configuration and is independent of the operating system; switching providers requires no client code changes. Platform details: [macOS](./macos-auto-update.md), [Windows](./windows-auto-update.md).

### Observability

| Variable | Description |
| --- | --- |
| `ASTRAVIA_SENTRY_DSN` | Sentry is a no-op when unset. The DSN ends up in the bundle |
| `ASTRAVIA_SENTRY_RELEASE` | Immutable release; must match exactly between runtime and source-map upload. Suggested: `astravia-desktop@<version>+<build-id>` |
| `ASTRAVIA_TELEMETRY_ENVIRONMENT` | `development` / `staging` / `production` |
| `ASTRAVIA_SENTRY_TRACES_SAMPLE_RATE` | 0–1, defaults to 0 |
| `ASTRAVIA_SENTRY_ORG` · `ASTRAVIA_SENTRY_PROJECT` · `ASTRAVIA_SENTRY_URL` | Source-map upload (CI only); `URL` is for self-hosted Sentry only |
| `ASTRAVIA_MAIN_SOURCEMAP` | Emit a main-process source map for local stack debugging without uploading |
| `ASTRAVIA_POSTHOG_KEY` | Project API Key (starts with `phc_`), **not** a Personal API Key. Ends up in the renderer bundle |
| `ASTRAVIA_POSTHOG_HOST` | Defaults to PostHog Cloud US |
| `ASTRAVIA_POSTHOG_REPLAY_ENABLED` · `ASTRAVIA_POSTHOG_REPLAY_SAMPLE_RATE` | Replay is off by default |
| `ASTRAVIA_TRACING` | Set to `langfuse` to trace agent / LLM / tool calls end to end |
| `ASTRAVIA_TRACING_TRACE_NAME` · `LANGFUSE_PUBLIC_KEY` · `LANGFUSE_BASE_URL` | Langfuse configuration |
| `LANGFUSE_TRACING_ENVIRONMENT` · `LANGFUSE_RELEASE` · `OTEL_SERVICE_NAME` | Optional metadata |

---

## Secrets

**Never put these in any `.env` file.** Inject them through the shell environment or CI secrets:

- **Cloudflare R2 upload credentials**: `ASTRAVIA_R2_ACCOUNT_ID`, `ASTRAVIA_R2_ACCESS_KEY_ID`, `ASTRAVIA_R2_SECRET_ACCESS_KEY`
- **macOS signing and notarization**: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_API_*`
  CI variants: `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
  Set none of them and you get an unsigned package; to sign, all of them are required. See [apple-code-signing.md](../deploy/apple-code-signing.md)
- **Sentry source-map upload**: `ASTRAVIA_SENTRY_AUTH_TOKEN`
- **Langfuse**: `LANGFUSE_SECRET_KEY`

`ASTRAVIA_REQUIRE_MAC_SIGNATURE=1` is only used by the macOS CI artifact verification step; it is not client configuration.

---

## CI

`.github/workflows/desktop-release.yml` resolves build configuration in the `prepare` job, which uses the `desktop-production` Environment. Precedence:

1. **Actions → desktop-release → Run workflow form** (`workflow_dispatch` only; `default` / empty means no override)
2. **Environment / repository Variables** (when the job sets `environment: desktop-production`, Environment values overlay same-named repository variables)
3. Built-in defaults: `ASTRAVIA_RELEASE_TARGET=github` selects open-source; `r2` selects commercial

Both editions read the `ASTRAVIA_OPEN_MARKETPLACE_REPOSITORY` Variable, optionally overridden by the
`marketplace_repository` input on manual runs. If neither is configured, no GitHub source is bundled.
To include the official source in an open-source distribution, set the Variable to
`https://github.com/maomaochong-ai/astravia-official-marketplace`; no code changes are needed.
An unconfigured commercial build uses only the cloud marketplace.

**A fork with no Variables set produces an open-source build.** For an official commercial build, put these on Settings → Environments → `desktop-production` → Environment variables (credentials stay in Environment secrets):

```
ASTRAVIA_CLOUD_ENABLED = true
ASTRAVIA_SERVER_URL    = https://api.example.com/api/v1
ASTRAVIA_SITE_URL      = https://www.example.com
ASTRAVIA_RELEASE_TARGET = r2
ASTRAVIA_UPDATE_URL     = https://releases.example.com/desktop/stable
ASTRAVIA_R2_BUCKET      = astravia-releases
ASTRAVIA_R2_PREFIX      = desktop/stable
```

Optional: `ASTRAVIA_UPDATE_URL_TEST` / `ASTRAVIA_R2_PREFIX_TEST` (and `_STABLE`). Choosing channel `test` on a manual run prefers those; otherwise a trailing `stable` / `test` / `beta` / `prod` / `production` segment is rewritten.

The form can override the edition, server URLs, tenant, speech input, publish target, and channel. GitHub + open-source and R2 + commercial must stay paired. **Do not type R2 keys, certificates, or DSNs into the form** — those stay in Secrets.

The release matrix waits for a dedicated quality job first: the root `bun run check`, quality-script tests, and Desktop packaging contract tests must pass before any platform build starts. Each platform then verifies updater metadata, hashes, blockmaps, and installable contents.

`workflow_dispatch` only builds and keeps an Actions artifact, and prints the resolved config on the job summary; it does not verify a live update feed. Only a release tag matching the `package.json` version publishes to R2 / GitHub Releases. After publishing, the workflow checks `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, and every referenced artifact through the public URL. The form is visible only after this workflow exists on the repository default branch.
