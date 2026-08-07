import { isAbsolute, relative, resolve, sep } from "node:path";
import { encodeConversationSessionId } from "./conversation-file-codec.js";

const CONVERSATION_FILE_SUFFIX = ".conversation.jsonl";

/** Resolve the canonical session ID encoded by a direct child conversation file. */
export function resolveSessionIdFromPath(conversationDir: string, sessionPath: string): string | undefined {
	const relativePath = relative(resolve(conversationDir), resolve(sessionPath));
	if (
		!relativePath ||
		isAbsolute(relativePath) ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		relativePath.includes(sep) ||
		!relativePath.endsWith(CONVERSATION_FILE_SUFFIX)
	) {
		return undefined;
	}

	const encoded = relativePath.slice(0, -CONVERSATION_FILE_SUFFIX.length);
	if (!encoded) return undefined;
	const sessionId = Buffer.from(encoded, "base64url").toString("utf8");
	return sessionId && encodeConversationSessionId(sessionId) === encoded ? sessionId : undefined;
}
