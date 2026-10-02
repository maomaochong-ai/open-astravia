/** Keep Chat and Agent Team on the shared ordinary Conversation message contract. */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const SOURCE_DIRECTORIES = Object.freeze([
	"apps/desktop/src/main/agent-teams",
	"apps/desktop/src/renderer",
	"packages/agent-team/src",
]);

export function findConversationMessageArchitectureViolations(files) {
	const violations = [];
	for (const file of files) {
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
		const isTest = /\.test\.[cm]?[jt]sx?$/u.test(file.path);
		const isComposableView =
			file.path.startsWith("apps/desktop/src/renderer/domains/conversation/conversation-view/") &&
			!isTest &&
			!/\.fixture\.[cm]?[jt]sx?$/u.test(file.path);
		if (isComposableView) {
			for (const [index, line] of file.text.split(/\r?\n/u).entries()) {
				const readsGlobalStore = /^import\s+(?!type\b)[^;]*from\s+["']@shared\/store\//u.test(line);
				if (readsGlobalStore || /\b\w+FnRef\b/u.test(line)) {
					violations.push(
						`${file.path}:${index + 1}: composable conversation parts take data and capabilities from the feed, not global state (ADR-0147)`,
					);
				}
			}
		}
		for (const [index, line] of file.text.split(/\r?\n/u).entries()) {
			if (/\brole\s*:\s*["']compaction["']/u.test(line)) {
				violations.push(`${file.path}:${index + 1}: compaction must be a timeline event, not a message role`);
			}
			if (!isTest && /(?:\buseSetAtom\(|\buseAtom\(|\bset\()\s*chatMessagesAtom\b/u.test(line)) {
				violations.push(
					`${file.path}:${index + 1}: write the message list through dispatchConversationFeed, not chatMessagesAtom (ADR-0146)`,
				);
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
