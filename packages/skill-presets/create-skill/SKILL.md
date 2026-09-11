---
name: create-skill
description: Create or update Vetta-compatible Agent Skills. Use when the user asks to create a skill, add a SKILL.md workflow, register a skill in skills-manifest.json, package a skill in a Vetta plugin, or add a built-in Vetta skill preset.
---

# Create a Vetta Skill

Create focused Agent Skills that Vetta can execute and display. Treat the Skill files and their registration metadata as one change.

## Choose the target

Infer the target from the request. If it is ambiguous, ask the user to choose before writing files.

| Target | Skill directory | Required registration |
| --- | --- | --- |
| Global Vetta product skill | `~/.vetta/skills/<skill-name>/` | Update `~/.vetta/skills-manifest.json`. |
| Project skill | `<project-root>/.vetta/skills/<skill-name>/` | No global manifest entry; project discovery is directory-based. |
| Plugin skill | `<plugin-root>/agent/skills/<skill-name>/` | Update `plugin.json` under `agent.skillPaths`. |
| Built-in Desktop skill | `<vetta-mono>/packages/skill-presets/<skill-name>/` | Update `<vetta-mono>/packages/skill-presets/skills-manifest.json`. |

Do not place a global product Skill only in `~/.vetta/agent/skills`; that directory is Agent-compatible but does not provide the Vetta product registration metadata required by the Skills UI.

## Understand the directory protection

Skill and scene roots — `~/.vetta/skills`, `~/.vetta/agent/skills`, `~/.vetta/scene`, `<project-root>/.vetta/skills`, and the `.agents/skills` equivalents — are read-only so that generated artifacts never land in them. Creating a new `<root>/<skill-name>/` directory is exempt: once this session authors that directory, every file inside it stays writable for the rest of the session.

An already-installed Skill stays read-only. `write` and `edit` reject its files, and a shell command that touches them returns a warning to move the output out. To change one, edit the source it was installed from — the plugin, the repository preset, or the project directory — or ask the user to uninstall it first. Never work around the rejection with shell redirection.

## Create the Skill

1. Convert the requested name to lowercase kebab-case. It must be 1-64 characters containing only lowercase letters, digits, and hyphens. The directory name must match the frontmatter `name`.
2. Inspect nearby Skills and relevant project documentation before writing. Reuse established terminology and tool names without copying unrelated instructions.
3. Create `<skill-directory>/SKILL.md` with YAML frontmatter containing `name` and `description`.
4. Write the body as imperative workflow instructions. State when to inspect context, when to ask a question, what files to create or edit, and how to verify completion.
5. Add `scripts/`, `references/`, or `assets/` only when genuinely required. Keep detailed reference material outside `SKILL.md` and link to it with relative paths.
6. Do not overwrite an existing Skill or unrelated configuration without reading it first. Ask before replacing intentional behavior. Inside a protected root, an existing Skill directory cannot be overwritten at all — see the directory protection above.

Use this minimal structure:

```markdown
---
name: example-skill
description: Describe what the Skill does and the user requests that should trigger it.
---

# Example Skill

Concise workflow instructions.
```

## Register a global Vetta Skill

Read the full `~/.vetta/skills-manifest.json` before editing it. The file is a root-level JSON object keyed by Skill name. Preserve every existing entry and add or update only the target Skill.

Use an entry shaped like this:

```json
{
  "example-skill": {
    "name": "example-skill",
    "version": "1.0.0",
    "installedAt": "<current ISO-8601 timestamp>",
    "source": "custom",
    "enabled": true,
    "type": "skill",
    "alias": "Optional display name",
    "description": "Description aligned with SKILL.md frontmatter"
  }
}
```

If the manifest does not exist, create it as `{}` before adding the entry. Keep it valid JSON and avoid replacing unrelated Skills. Use the actual current timestamp rather than a placeholder.

## Register a built-in Desktop Skill

Read the full `packages/skill-presets/skills-manifest.json`. Preserve existing entries and add the new Skill with `source: "builtin"`, `enabled: true`, `type: "skill"`, a version, and display metadata. The manifest key, entry `name`, directory name, and `SKILL.md` frontmatter name must all match.

The Desktop build only packages enabled directories registered in this manifest. An unregistered preset is an error.

## Update plugin configuration

Only plugin-packaged Skills use `plugin.json` registration.

1. Read the full `plugin.json` before editing it.
2. Preserve every existing `agent` field and every existing `skillPaths` entry.
3. Add a plugin-relative path. Prefer a shared parent such as `"agent/skills"` when it intentionally contains all plugin Skills; otherwise add the specific Skill directory.
4. Do not add duplicate paths.

Example:

```json
{
  "agent": {
    "skillPaths": ["agent/skills"]
  }
}
```

## Quality rules

- Keep the frontmatter valid YAML at the start of the file.
- Make `description` specific enough for reliable triggering; include both the capability and common request language.
- Keep `SKILL.md` under 500 lines. Move large examples and domain references into `references/`.
- Use relative links for files inside the Skill directory.
- Do not hardcode secrets, machine-specific absolute paths, or destructive commands.
- Prefer the minimum files and instructions needed for the requested workflow.

## Verify

1. Confirm the final directory matches the selected target.
2. Confirm `SKILL.md` exists and its frontmatter name matches the directory.
3. Confirm the description clearly states when the Skill should run.
4. For global or built-in Skills, parse the complete `skills-manifest.json` and confirm the target entry is present without losing existing entries.
5. For plugin Skills, confirm `plugin.json` contains the correct relative `agent.skillPaths` entry and remains valid JSON.
6. Report created or modified files and any validation that was not run.
