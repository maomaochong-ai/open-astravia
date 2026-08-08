# Development Rules

> ! 使用中文回答用户的问题

## First Message
If the user did not give you a concrete task in their first message,
read README.md, then ask which module(s) to work on. Based on the answer, read the relevant README.md files in parallel.
- packages/ai/README.md
- packages/agent/README.md
- packages/coding-agent/README.md
- packages/mom/README.md
- packages/pods/README.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals (behavior changes include tests — see **Testing**):
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Testing

**Behavior changes require runnable tests, green before handoff.** The monorepo is large enough that tests are not optional. Package-level `AGENTS.md` may tighten this (e.g. desktop-app); it must not weaken it.

### What to test (scope)

**Must test** (behavior with a fixed expected outcome):
- Business rules, validation, state machines, error classification/mapping, authz and edge cases
- Bug fixes: failing repro first, then green
- Protocol / IPC / schema / public API contracts and compatibility
- Non-trivial parse, transform, or selection logic (table-driven input → output)

**Usually skip**:
- Copy-only / style-only / branchless layout and wiring
- One-off scripts, docs-only, config with no logic
- Behavior that only a real environment can express stably — use the package’s existing e2e / canary / `verify:ui` (or similar) and say so in the handoff

**Prefer decisions and data over full UI trees.** Extract pure functions and unit-test them; test components only when the interaction itself is the requirement.

### How to write

- **Lightest tool first:** Vitest `node` for pure functions; opt in per-file `jsdom` (or the package’s existing pattern) only when DOM is required. Do not default to mounting full React trees or pull in unstandardized frameworks for a single interaction.
- **Assert observable behavior** (outputs, state, call contracts), not implementation noise (private shape, incidental class names, call-order thrash).
- **Mock sparingly:** unstable I/O only (network, clock, filesystem boundaries); never mock away the logic under test.
- **Small and stable:** one intent per case; table-drive edges and regressions; avoid order-dependent or live-network flaky tests.
- **Ship with the change:** place tests where the package already expects them (`*.test.ts` / package `test/`); run at least the tests touched by this change.

### How to run

See **Commands** below. `bun run check` does **not** run tests — you must run them separately.

## Code Quality
- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports for types** - no `import("pkg").Type` in type positions and no dynamic imports used only to obtain types. Runtime `import()` is allowed only for deliberate code splitting or lazy loading; ordinary dependencies must still use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)
- **不要写死用户可见的语言文案。** 对已接入 i18n 的包（目前 `packages/desktop-app`）所有面向用户的文案（label/按钮/placeholder/菜单/通知/title/aria-label…）必须走 i18n，不得硬编码中文字符串；新增文案也一样。具体约定见该包 `AGENTS.md` 的「i18n 国际化」一节与 `docs/adr/0031`。模块级常量同样不能存中文——改存 i18n key、渲染期再解析。（不含代码注释、日志、发给 LLM/协议串——这些保持原样。）

## Component and Module Design

**Single responsibility first. Prefer readable composition over large files.**

- Do not put multiple unrelated responsibilities into one component or one file.
- Keep entry files thin: registration, routing, and wiring only. Move rendering, parsing, stateful behavior, constants, and utility functions into dedicated modules.
- Split large UI features by domain role, for example: container/state component, presentational components, shared UI primitives, parsing/adapters, constants, and types.
- If a component grows enough that a reader must understand several independent concerns at once, split it before adding more behavior.
- Avoid "god components" that own data loading, parsing, virtualization, rendering, toolbar actions, and error states together.
- Keep reusable UI states such as loading, empty, error, and toolbar controls in small shared components when used by more than one preview/view.
- Keep format-specific adapters isolated. A PDF renderer, DOCX renderer, spreadsheet parser, and presentation fallback should not depend on each other's internals.
- Prefer explicit file names that describe responsibility (`PdfPreview.tsx`, `parseWorkbook.ts`, `SheetTabs.tsx`) over generic names (`utils.ts`, `helpers.ts`, `Component.tsx`) unless the module is truly generic.
- Do not create abstractions only to satisfy style. Split when it improves local reasoning, testing, or future changes.
- When adding a new complex feature, design the file/module layout before implementation and state it briefly in the plan.

## Commands
- Use Bun for package management and scripts (`bun`/`bunx`) unless the user explicitly asks for npm.
- During a code task, use `bun run check:quick` for fast feedback on every changed file. It covers committed branch differences, staged, unstaged, and untracked files, but intentionally does not typecheck.
- After completing one round of code changes (not after every edit, and not for documentation-only changes), run `bun run check` once with full output. Fix all errors, warnings, and infos before handing off or opening a PR.
- Root `bun run check` runs full Biome, monorepo `tsgo --noEmit`, **desktop-app** `tsc --noEmit` (`packages/desktop-app/tsconfig.json`), **admin** `tsc -b` (`packages/admin`), and quality guards (`check:guards`) in parallel. Do not skip desktop by only running `tsc`/`tsgo` at repo root without `-p packages/desktop-app/tsconfig.json`. desktop-app and admin are **not** in the root `tsconfig.json` `include` — they are only typechecked via their own project configs, so dropping either from `check:types` silently stops checking them.
- Quality gates (layered): see `docs/dev/quality-gates.md`. Husky pre-commit runs **fast** `check:precommit` (staged Biome + key/conflict guards) only; full typecheck is **not** in the hook — still run `bun run check` before PR.
- **Behavior changes must run related tests** (see **Testing**). Prefer targeted runs: `bunx vitest --run <path-to-test>`, or `bun run test:pkg <…>` / `bun run test:changed`; `bun run test:unit` covers ai/agent/coding-agent/ecosystem-adapter. Full package suite: `bun run test` from the **package root**. Root `bun run test` walks every workspace package that defines `test` — do not use it as the default feedback loop.
- Note: `bun run check` does not run tests. Optional dead-code report: `bun run deadcode:report` (Knip; not part of `check`).
- NEVER run: `bun run dev`, `bun run build`, `bun test` (bare `bun test` tends to over-scan the monorepo; use targeted runs or package `bun run test` above)
- desktop-app UI verification must use root `bun run verify:ui:*` only. AI may run
  `verify:ui:start` (long-lived), `verify:ui:status`, `verify:ui:attach`,
  `verify:ui:pw -- <playwright-cli args>`, `verify:ui:debug -- <debug args>`,
  `verify:ui:detach`, and `verify:ui:stop`;
  do not bypass via `bun run dev`. Full flow: `docs/dev/README.md`.
  `verify:ui:*` is **not** a substitute for unit/behavior tests.
- Vitest is a monorepo-root `devDependency`; packages may keep their own `vitest.config.*` and `"test"` script. Written tests must be green; if they fail, fix the test or the implementation and re-run until pass.
- NEVER commit unless user asks

## Style
- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Changelog
Location: `packages/*/CHANGELOG.md` (each package has its own)

### Format
Use these sections under `## [Unreleased]`:
- `### Breaking Changes` - API changes requiring migration
- `### Added` - New features
- `### Changed` - Changes to existing functionality
- `### Fixed` - Bug fixes
- `### Removed` - Removed features

### Rules
- Before adding entries, read the full `[Unreleased]` section to see which subsections already exist
- New entries ALWAYS go under `## [Unreleased]` section
- Append to existing subsections (e.g., `### Fixed`), do not create duplicates
- NEVER modify already-released version sections (e.g., `## [0.12.2]`)
- Each version section is immutable once released

### Attribution
- **Internal changes (from issues)**: `Fixed foo bar (#123)`
- **External contributions**: `Added feature X (#456 by @username)`

## Adding a New Monorepo Package

新增 `packages/*` 下的 `@vetta/*` TypeScript workspace 包时，除 scaffold 外必须接 workspace、TS path maps、`build.sh` 分层等。完整 checklist 见：

→ [`docs/monorepo-new-package.md`](docs/monorepo-new-package.md)

最易漏：根 `tsconfig.json` 的 `paths` + `include`，以及（若 desktop 引用）`packages/desktop-app/tsconfig.json` 的 `paths`（指向 **源码**，不要只靠 `dist/`）。

## Adding a New LLM Provider (packages/ai)

Adding a new provider requires changes across multiple files:

### 1. Core Types (`packages/ai/src/types.ts`)
- Add API identifier to `Api` type union (e.g., `"bedrock-converse-stream"`)
- Create options interface extending `StreamOptions`
- Add mapping to `ApiOptionsMap`
- Add provider name to `KnownProvider` type union

### 2. Provider Implementation (`packages/ai/src/providers/`)
Create provider file exporting:
- `stream<Provider>()` function returning `AssistantMessageEventStream`
- Message/tool conversion functions
- Response parsing emitting standardized events (`text`, `tool_call`, `thinking`, `usage`, `stop`)

### 3. Stream Integration (`packages/ai/src/stream.ts`)
- Import provider's stream function and options type
- Add credential detection in `getEnvApiKey()`
- Add case in `mapOptionsForApi()` for `SimpleStreamOptions` mapping
- Add provider to `streamFunctions` map

### 4. Model Generation (`packages/ai/scripts/generate-models.ts`)
- Add logic to fetch/parse models from provider source
- Map to standardized `Model` interface

### 5. Tests (`packages/ai/test/`)
Add provider to: `stream.test.ts`, `tokens.test.ts`, `abort.test.ts`, `empty.test.ts`, `context-overflow.test.ts`, `image-limits.test.ts`, `unicode-surrogate.test.ts`, `tool-call-without-result.test.ts`, `image-tool-result.test.ts`, `total-tokens.test.ts`, `cross-provider-handoff.test.ts`.

For `cross-provider-handoff.test.ts`, add at least one provider/model pair. If the provider exposes multiple model families (for example GPT and Claude), add at least one pair per family.

For non-standard auth, create utility (e.g., `bedrock-utils.ts`) with credential detection.

### 6. Coding Agent (`packages/coding-agent/`)
- `src/core/model-resolver.ts`: Add default model ID to `DEFAULT_MODELS`
- `src/cli/args.ts`: Add env var documentation
- `README.md`: Add provider setup instructions

### 7. Documentation
- `packages/ai/README.md`: Add to providers table, document options/auth, add env vars
- `packages/ai/CHANGELOG.md`: Add entry under `## [Unreleased]`

## Releasing

**Lockstep versioning**: All packages always share the same version number. Every release updates all packages together.
**Version source of truth**: release version follows `@vetta/coding-agent`.

**Version semantics** (no major releases):
- `patch`: Bug fixes and new features
- `minor`: API breaking changes

### Steps

1. **Update CHANGELOGs**: Ensure all changes since last release are documented in the `[Unreleased]` section of each affected package's CHANGELOG.md

2. **Run release script**:
   ```bash
   bun run release:patch    # Fixes and additions
   bun run release:minor    # API breaking changes
   ```

Private release defaults:
- Default behavior does NOT publish packages.
- Set `RELEASE_PUBLISH=true` to publish to the configured private registry.
- Optional: set `RELEASE_BRANCH=<branch>` to override the push target branch (default: current branch).

The script handles: version bump, CHANGELOG finalization, commit, tag, optional private publish, and adding new `[Unreleased]` sections.
After release, artifacts and install guide are generated under `releases/v<version>/` for uploading to Gitee Releases.

## **CRITICAL** Tool Usage Rules **CRITICAL**
- NEVER use sed/cat to read a file or a range of a file. Always use the read tool (use offset + limit for ranged reads).
- You MUST read every file you modify in full before editing.

## **CRITICAL** Git Rules for Parallel Agents **CRITICAL**

Multiple agents may work on different files in the same worktree simultaneously. You MUST follow these rules:

### Committing
- 使用中文写 Commit Message
- **不要**在 commit message 中添加作者信息（如 `Co-Authored-By`、`Signed-off-by` 等）
- **ONLY commit files YOU changed in THIS session**
- ALWAYS include `fixes #<number>` or `closes #<number>` in the commit message when there is a related ticket
- NEVER use `git add -A` or `git add .` - these sweep up changes from other agents
- ALWAYS use `git add <specific-file-paths>` listing only files you modified
- Before committing, run `git status` and verify you are only staging YOUR files
- Track which files you created/modified/deleted during the session

### Forbidden Git Operations
These commands can destroy other agents' work:
- `git reset --hard` - destroys uncommitted changes
- `git checkout .` - destroys uncommitted changes
- `git clean -fd` - deletes untracked files
- `git stash` - stashes ALL changes including other agents' work
- `git add -A` / `git add .` - stages other agents' uncommitted work
- `git commit --no-verify` - bypasses required checks and is never allowed

### Safe Workflow
```bash
# 1. Check status first
git status

# 2. Add ONLY your specific files
git add packages/ai/src/providers/transform-messages.ts
git add packages/ai/CHANGELOG.md

# 3. Commit
git commit -m "fix(ai): description"

# 4. Push (pull --rebase if needed, but NEVER reset/checkout)
git pull --rebase && git push
```

### If Rebase Conflicts Occur
- Resolve conflicts in YOUR files only
- If conflict is in a file you didn't modify, abort and ask the user
- NEVER force push
