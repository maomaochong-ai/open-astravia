---
name: publish-ability
description: Publish a skill, scene, MCP server, plugin, or bundle to the Vetta ability marketplace. Use when the user asks to upload/publish/submit an ability, put a plugin on the marketplace, share a skill with other users, or migrate an existing package into Vetta.
metadata:
  version: 2.0.0
  author: Vetta
  category: 开发
---

# Publish an Ability to the Vetta Marketplace

Submitting is a **local** action: it reads an archive from the user's disk, so it runs through
the bundled script rather than a tool call.

```bash
node "$SKILL_DIR/scripts/publish.mjs" --input /abs/path/to/payload.json
```

Checking review status afterwards is a **remote** action — use the `list_my_abilities` tool from
the built-in `vetta` MCP server. It is always available and needs no setup.

## Procedure

1. **Determine the type.** Ask the user if it is not obvious from the artifact.

   | Type | What it is | Physical artifact |
   | --- | --- | --- |
   | `skill` | A `SKILL.md` workflow | `.zip` / `.tar.gz` containing `SKILL.md` |
   | `scene` | A skill installed into the scene directory | same as `skill` |
   | `plugin` | A Vetta plugin | `.zip` containing `plugin.json` |
   | `mcp` | One entry in the user's `mcp.json` | none — config only |
   | `bundle` | A named group of already-published abilities | none — references only |

2. **Source `detail` from the package. Do not invent it.** `name`, `description`, `author`, and
   `content` are all required and the submission is rejected without them. Read `plugin.json`
   (`name`/`description`/`author`), `SKILL.md` frontmatter, `README.md`, `LICENSE`. Ask the user
   for anything you cannot source.

   `content` is the detail-page body in markdown — it is what a user reads to decide whether to
   install. Write what the ability does, when to use it, and any setup it needs. A one-line
   `content` is not acceptable.

3. **Write the payload to a JSON file**, then pass it with `--input`. Never try to pass fields as
   command-line arguments: `content` is multi-line markdown containing backticks, quotes and `$`,
   and the shell will mangle it.

   Full field reference: [references/payload.md](references/payload.md) — read it when you need
   anything beyond the four required `detail` fields.

4. **Dry-run first** when the payload is non-trivial. This runs the same validation without
   submitting, so you spend no network round-trip on a payload that was never going to pass:

   ```bash
   node "$SKILL_DIR/scripts/publish.mjs" --input payload.json --dry-run
   ```

5. **Submit.** On failure the script returns *all* problems at once — fix the whole list before
   retrying rather than resubmitting after each single fix.

## Script contract

- **stdout is a single JSON object**; exit code 0 = success, 1 = failure.
- Failure shape: `{"ok": false, "message": "...", "errors": [...]}` — `errors` is present for
  validation failures.
- Success shape: `{"ok": true, "message": "...", "slug": "...", "version": "...",
  "review_status": "...", "has_pending": bool}`.
- Input may also arrive on stdin (`cat payload.json | node .../publish.mjs`) if that is more
  convenient than a temp file.
- The script reads the login token from `~/.vetta/auth.json` itself. If it reports "未登录", tell
  the user to log in through the Vetta client — do not attempt to pass credentials yourself.

## Review

Submissions from non-administrators enter a review queue and are **not** visible in the
marketplace until an administrator approves them. Tell the user this rather than implying the
ability is live.

Re-submitting an ability that is already published does not disturb it: the new version waits in
a pending slot while the marketplace keeps serving the current version, so installed users are
unaffected until the update is approved. `has_pending: true` in the result means exactly this.

You may only submit updates to abilities you own. Submitting to a slug owned by someone else is
rejected.

## Verify

After a successful run, state the returned `slug`, `version`, and whether the ability is live or
pending review. If the run failed, fix every listed error and retry — do not report success.

Use `list_my_abilities` to report progress later: `review_status` is `pending`, `approved`, or
`rejected` (reason in `review_note`); a non-empty `pending_version` means an update is queued
behind the live version.
