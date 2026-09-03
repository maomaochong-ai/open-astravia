/** Keep Chat and Agent Team on the shared ordinary Conversation message contract. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const SOURCE_DIRECTORIES = Object.freeze([
	"apps/desktop/src/main/agent-teams",
	"apps/desktop/src/renderer",
	"packages/agent-team/src",
]);

const RETIRED_IDENTIFIERS = Object.freeze([
	"ChatMessage",
	"TeamFeedEvent",
	"TeamMessageFeed",
	"TeamTimelineItemViewModel",
	"createUserMessageEvent",
	"createMemberResultEvent",
	"createMemberDelegationEvent",
	"finalizeTeamMemberTurn",
	"createLegacyTeamDelegationPort",
	"createTeamDelegateTool",
	"ConversationMessageActionModel",
	"TeamConversationFeed",
	"TeamInputBar",
	"TeamMessageList",
	"TeamRecipientSelector",
	"renderActions",
	"actionSlot",
]);

export function findConversationMessageArchitectureViolations(files) {
	const violations = [];
	for (const file of files) {
		if (file.path.startsWith("apps/desktop/src/renderer/domains/chat/")) {
			violations.push(`${file.path}: retired chat domain must remain migrated to domains/conversation`);
		}
		if (
			file.path.startsWith("apps/desktop/src/renderer/domains/conversation/connectors/team/") &&
			/(?:MessageInput|MessageFeed\.VirtualList|ConversationEditorView)/u.test(file.text)
		) {
			violations.push(`${file.path}: Team connector must compose the shared conversation recipe`);
		}
		if (
			file.path.includes("/shared/components/message-feed/") &&
			/(?:domains\/(?:chat|agent-teams)|@shared\/store|@preload\/api|shared\/conversation)/u.test(file.text)
		) {
			violations.push(`${file.path}: product-neutral MessageFeed imports a product or message domain`);
		}
		if (file.path.startsWith("packages/agent-team/") && /@vetta\/runtime-subagents/u.test(file.text)) {
			violations.push(`${file.path}: Agent Team must not depend on the private subagent runtime`);
		}
		for (const [index, line] of file.text.split(/\r?\n/u).entries()) {
			for (const identifier of RETIRED_IDENTIFIERS) {
				if (!new RegExp(`\\b${identifier}\\b`, "u").test(line)) continue;
				violations.push(`${file.path}:${index + 1}: retired message identifier ${identifier}`);
			}
			if (/\bcreateMessageSlot\b/u.test(line)) {
				violations.push(
					`${file.path}:${index + 1}: createMessageSlot is forbidden; compose explicit primitives or a domain recipe`,
				);
			}
			if (/['"]team_delegate['"]/u.test(line)) {
				violations.push(`${file.path}:${index + 1}: retired synchronous Team tool team_delegate`);
			}
			if (/\brole\s*:\s*["']compaction["']/u.test(line)) {
				violations.push(`${file.path}:${index + 1}: compaction must be a timeline event, not a message role`);
			}
		}
	}
	return violations;
}

export function collectConversationMessageArchitectureFiles() {
	return SOURCE_DIRECTORIES.flatMap((directory) =>
		walkFiles(join(repoRoot, directory), { extensions: [".ts", ".tsx"] }).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
	);
}

if (isDirectRun(import.meta.url)) {
	const files = collectConversationMessageArchitectureFiles();
	const violations = findConversationMessageArchitectureViolations(files);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[conversation-message-architecture] ${violation}`);
	} else {
		ok(`[conversation-message-architecture] ok (${files.length} source files)`);
	}
}
