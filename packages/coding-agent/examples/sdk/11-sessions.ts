/**
 * Session Management
 *
 * Control session persistence: in-memory, new file, continue, or open specific.
 */

import { join } from "node:path";
import { createCodingAgentSession, createCodingAgentSessionCatalog } from "@vetta/coding-agent/sdk";

const cwd = process.cwd();
const conversationDir = join(cwd, ".vetta", "conversations");
const catalog = createCodingAgentSessionCatalog({ cwd, conversationDir });

// In-memory (no persistence)
const { session: inMemory } = await createCodingAgentSession({
	storage: { kind: "memory" },
});
console.log("In-memory session:", inMemory.sessionFile ?? "(none)");

// New persistent session
const { session: newSession } = await createCodingAgentSession({
	cwd,
	storage: { kind: "file-create", conversationDir },
});
console.log("New session file:", newSession.sessionFile);
await newSession.close();

// Continue most recent session (or create new if none)
const recent = await catalog.findRecent();
const { session: continued, modelFallbackMessage } = await createCodingAgentSession({
	cwd,
	storage: recent
		? { kind: "file-resume", conversationDir, sessionPath: recent.path }
		: { kind: "file-create", conversationDir },
});
if (modelFallbackMessage) console.log("Note:", modelFallbackMessage);
console.log("Continued session:", continued.sessionFile);

// List and open specific session
await continued.close();
const sessions = await catalog.list();
console.log(`\nFound ${sessions.length} sessions:`);
for (const info of sessions.slice(0, 3)) {
	console.log(`  ${info.id.slice(0, 8)}... - "${info.firstMessage.slice(0, 30)}..."`);
}

if (sessions.length > 0) {
	const { session: opened } = await createCodingAgentSession({
		cwd,
		storage: { kind: "file-resume", conversationDir, sessionPath: sessions[0].path },
	});
	console.log(`\nOpened: ${opened.sessionId}`);
}

// Custom session directory (no cwd encoding)
// const customDir = "/path/to/my-sessions";
// const customCatalog = createCodingAgentSessionCatalog({ cwd, conversationDir: customDir });
// const { session } = await createCodingAgentSession({
//   cwd,
//   storage: { kind: "file-create", conversationDir: customDir },
// });
// await customCatalog.list();
// await customCatalog.findRecent();
