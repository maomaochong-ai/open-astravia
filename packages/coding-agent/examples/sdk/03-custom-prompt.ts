/**
 * Custom System Prompt
 *
 * Shows how to replace or modify the default system prompt.
 */

import { createCodingAgentSession } from "@vetta/coding-agent/sdk";

// Option 1: Replace prompt entirely
const { session: session1 } = await createCodingAgentSession({
	storage: { kind: "memory" },
	resources: {
		systemPrompt: `You are a helpful assistant that speaks like a pirate.
Always end responses with "Arrr!"`,
	},
	// Empty content suppresses an automatically discovered append prompt for this replacement example.
	appendSystemPrompt: "",
});

session1.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

console.log("=== Replace prompt ===");
await session1.prompt("What is 2 + 2?");
console.log("\n");

// Option 2: Append instructions to the default prompt
const { session: session2 } = await createCodingAgentSession({
	storage: { kind: "memory" },
	appendSystemPrompt: "## Additional Instructions\n- Always be concise\n- Use bullet points when listing things",
});

session2.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

console.log("=== Modify prompt ===");
await session2.prompt("List 3 benefits of TypeScript.");
console.log();
