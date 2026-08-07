/**
 * Minimal SDK Usage
 *
 * Uses all defaults: discovers skills, extensions, tools, context files
 * from cwd and ~/.vetta/agent. Model chosen from settings or first available.
 */

import { createCodingAgentSession } from "@vetta/coding-agent/sdk";

const { session } = await createCodingAgentSession();

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("What files are in the current directory?");
session.messages.forEach((msg) => {
	console.log(msg);
});
console.log();
