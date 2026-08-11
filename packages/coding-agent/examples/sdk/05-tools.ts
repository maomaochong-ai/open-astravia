/**
 * Tools Configuration
 *
 * Use built-in tool sets or individual tools.
 *
 * The stable SDK accepts built-in tool names and resolves every tool against
 * the Session cwd inside the product composition.
 */

import { createCodingAgentSession } from "@vetta/coding-agent/sdk";

// Read-only mode (no edit/write)
await createCodingAgentSession({
	activeTools: ["read", "grep", "glob", "find", "ls", "dir_tree"],
	storage: { kind: "memory" },
});
console.log("Read-only session created");

// Custom built-in tool selection
await createCodingAgentSession({
	activeTools: ["read", "bash", "grep"],
	storage: { kind: "memory" },
});
console.log("Custom tools session created");

// Tool implementations resolve paths against this cwd.
const customCwd = "/path/to/project";
await createCodingAgentSession({
	cwd: customCwd,
	storage: { kind: "memory" },
});
console.log("Custom cwd session created");

// Or pick specific built-ins for the custom cwd.
await createCodingAgentSession({
	cwd: customCwd,
	activeTools: ["read", "bash", "grep"],
	storage: { kind: "memory" },
});
console.log("Specific tools with custom cwd session created");
