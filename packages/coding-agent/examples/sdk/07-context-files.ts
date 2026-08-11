/**
 * Context Files (AGENTS.md)
 *
 * Context files provide project-specific instructions loaded into the system prompt.
 */

import { createCodingAgentSession } from "@vetta/coding-agent/sdk";

const { session } = await createCodingAgentSession({
	storage: { kind: "memory" },
	resources: {
		contextFiles: [
			{
				path: "/virtual/AGENTS.md",
				content: `# Project Guidelines

## Code Style
- Use TypeScript strict mode
- No any types
- Prefer const over let`,
			},
		],
	},
});

console.log("Context contribution loaded:", session.getSystemPrompt().includes("Prefer const over let"));
