# SDK Examples

Programmatic usage through the stable `@vetta/coding-agent/sdk` entry. Concrete authentication, model and settings
services use the stable Host adapter in `@vetta/coding-agent/host-services`.

## Examples

| File | API | Description |
|------|-----|-------------|
| `01-minimal.ts` | Stable SDK | Simplest usage with all defaults |
| `02-custom-model.ts` | Host services | Custom provider registration through a stable Host |
| `03-custom-prompt.ts` | Stable SDK | Replace or append the system prompt |
| `04-skills.ts` | Stable SDK | Inline and dynamic Skill contributions with declarative filtering |
| `05-tools.ts` | Stable SDK | Built-in tool activation by name |
| `06-extensions.ts` | Stable SDK | Dynamic Extension path sources and event observation |
| `07-context-files.ts` | Stable SDK | Explicit AGENTS.md-style context contribution |
| `08-prompt-templates.ts` | Stable SDK | Inline prompt templates |
| `09-api-keys-and-oauth.ts` | Host services | API key resolution and OAuth configuration |
| `10-settings.ts` | Host services | Persistent and in-memory settings |
| `11-sessions.ts` | Stable SDK | In-memory, persistent, recent and listed sessions |

## Running

```bash
cd packages/coding-agent
bun examples/sdk/01-minimal.ts
```

## Quick Reference

```typescript
import { join } from "node:path";
import { getModel } from "@vetta/ai";
import {
  createCodingAgentSession,
  createCodingAgentSessionCatalog,
} from "@vetta/coding-agent/sdk";

const cwd = process.cwd();
const conversationDir = join(cwd, ".vetta", "conversations");
const model = getModel("anthropic", "claude-opus-4-5");

const { session, diagnostics } = await createCodingAgentSession({
  cwd,
  model,
  thinkingLevel: "high",
  storage: { kind: "file-create", conversationDir },
  activeTools: ["read", "grep", "glob"],
  appendSystemPrompt: "Be concise.",
  resources: {
    contextFiles: [{ path: join(cwd, "SDK_CONTEXT.md"), content: "Use strict TypeScript." }],
    promptTemplates: [{ name: "review", description: "Review changes", content: "Review this diff." }],
  },
});

const catalog = createCodingAgentSessionCatalog({ cwd, conversationDir });
const recent = await catalog.findRecent();
console.log({ diagnostics, recent });

// Run prompts
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});
await session.prompt("Hello");
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `cwd` | `process.cwd()` | Working directory |
| `agentDir` | Vetta agent directory | Configuration and discovered resources |
| `storage` | In-memory | Memory, native file creation or native file resume |
| `model` | Settings or first available | Model value selected for the Session |
| `thinkingLevel` | Settings default | Reasoning level |
| `activeTools` | Scenario policy | Explicit built-in tool names |
| `customTools` | `[]` | Session-private tool definitions |
| `resources` | Discovered resources | Stable path and inline resource contributions |
| `skillSources` | `[]` | Session-owned dynamic Skill contribution sources |
| `extensionSources` | `[]` | Session-owned dynamic Extension path sources |
| `appendSystemPrompt` | Discovered append prompt | Additional system instructions |

Credential storage, custom provider registration and persistent settings are host concerns. Import `AuthStorage`,
`ModelRegistry`, `SettingsRuntime` and `createCodingAgentHostWithServices` from
`@vetta/coding-agent/host-services`. The Host owns its Sessions while the caller continues to own the concrete shared
services. Complete loader and composition replacement remains on the package-root compatibility API.

## Events

```typescript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      break;
    case "tool_execution_start":
      console.log(`Tool: ${event.toolName}`);
      break;
    case "tool_execution_end":
      console.log(`Result: ${event.result}`);
      break;
    case "agent_end":
      console.log("Done");
      break;
  }
});
```
