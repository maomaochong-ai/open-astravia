/**
 * Extensions Configuration
 *
 * Extensions intercept agent events and can register custom tools.
 * They provide a unified system for extensions, custom tools, commands, and more.
 *
 * By default, extension files are discovered from:
 * - ~/.vetta/agent/extensions/
 * - <cwd>/.vetta/extensions/
 * - Paths specified in settings.json "extensions" array
 *
 * An extension is a TypeScript file that exports a default function:
 *   export default function (api: ExtensionAPI) { ... }
 */

import type { CodingAgentExtensionSourceSnapshot } from "@vetta/coding-agent/sdk";
import { createCodingAgentSession } from "@vetta/coding-agent/sdk";

// Extensions are discovered automatically from standard locations.
// A source can change its revision and paths while the Session is alive.
let extensions: CodingAgentExtensionSourceSnapshot = {
	revision: 1,
	paths: ["./my-logging-extension.ts", "./my-safety-extension.ts"],
};

const { session } = await createCodingAgentSession({
	storage: { kind: "memory" },
	extensionSources: [{ id: "project-extensions", read: () => extensions }],
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("List files in the current directory.");
console.log();

extensions = { revision: 2, paths: ["./my-logging-extension.ts"] };
await session.reload();
await session.close();

// Example extension file (./my-logging-extension.ts):
/*
import type { ExtensionAPI } from "@vetta/coding-agent/extensions";

export default function (api: ExtensionAPI) {
	api.on("agent_start", async () => {
		console.log("[Extension] Agent starting");
	});

	api.on("tool_call", async (event) => {
		console.log(\`[Extension] Tool: \${event.toolName}\`);
		// Return { block: true, reason: "..." } to block execution
		return undefined;
	});

	api.on("agent_end", async (event) => {
		console.log(\`[Extension] Done, \${event.messages.length} messages\`);
	});

	// Register a custom tool
	api.registerTool({
		name: "my_tool",
		label: "My Tool",
		description: "Does something useful",
		parameters: Type.Object({
			input: Type.String(),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => ({
			content: [{ type: "text", text: \`Processed: \${params.input}\` }],
			details: {},
		}),
	});

	// Register a command
	api.registerCommand("mycommand", {
		description: "Do something",
		handler: async (args, ctx) => {
			ctx.ui.notify(\`Command executed with: \${args}\`);
		},
	});
}
*/
