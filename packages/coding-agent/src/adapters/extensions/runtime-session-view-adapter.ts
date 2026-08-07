import { dirname } from "node:path";
import type { AgentMessage } from "@vetta/agent-core";
import type { ConversationDocument, RuntimeSessionCoreAssembly } from "@vetta/runtime-core";
import type { ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import type { ExtensionSessionView as ReadonlySessionManager } from "../../extensions/index.js";
import {
	CODING_AGENT_SESSION_VIEW_VERSION,
	type CodingAgentCustomMessageEntry as CustomMessageEntry,
	projectCodingAgentSessionTree,
	readCodingAgentSessionBranch,
	readCodingAgentSessionLabels,
	restoreCodingAgentSessionAgentMessageEntry,
	type CodingAgentSessionEntry as SessionEntry,
	type CodingAgentSessionHeader as SessionHeader,
	type CodingAgentSessionTreeNode as SessionTreeNode,
} from "../../sessions/index.js";

/**
 * 将 Runtime Core 的只读 Conversation 投影为 ExtensionContext 所需的窄会话视图。
 *
 * 该适配器不持有 Repository，也不开放历史写 API；每次读取都基于当前
 * ConversationDocument，因此续接、分支切换和元数据更新会即时可见。
 */
export function createCodingAgentExtensionSessionView(assembly: RuntimeSessionCoreAssembly): ReadonlySessionManager {
	const readDocument = (): ConversationDocument => assembly.conversationView.readDocument();
	const readEntries = (): SessionEntry[] => readDocument().entries.map(toSessionEntry);
	const readCwd = (): string => assembly.workspaceView.readWorkingDirectory() ?? readDocument().identity.cwd ?? "";

	return {
		getCwd: readCwd,
		getSessionDir: () => {
			const sessionPath = assembly.lifecycle.sessionPath;
			return sessionPath ? dirname(sessionPath) : readCwd();
		},
		getSessionId: () => readDocument().identity.sessionId,
		getSessionFile: () => assembly.lifecycle.sessionPath,
		getLeafId: () => readDocument().activeLeafId,
		getLeafEntry: () => {
			const document = readDocument();
			const entry = document.activeLeafId
				? document.entries.find(({ id }) => id === document.activeLeafId)
				: undefined;
			return entry ? toSessionEntry(entry) : undefined;
		},
		getEntry: (id) => {
			const entry = readDocument().entries.find((candidate) => candidate.id === id);
			return entry ? toSessionEntry(entry) : undefined;
		},
		getLabel: (id) => readCodingAgentSessionLabels(readEntries()).get(id),
		getBranch: (fromId) => {
			const document = readDocument();
			return readCodingAgentSessionBranch(document.entries.map(toSessionEntry), fromId ?? document.activeLeafId);
		},
		getHeader: () => toSessionHeader(readDocument()),
		getEntries: readEntries,
		getTree: (): SessionTreeNode[] => {
			const document = readDocument();
			const entries = document.entries.map(toSessionEntry);
			return projectCodingAgentSessionTree(entries, readCodingAgentSessionLabels(entries));
		},
		getSessionName: () => readDocument().name,
	};
}

function toSessionHeader(document: ConversationDocument): SessionHeader {
	return {
		type: "session",
		version: CODING_AGENT_SESSION_VIEW_VERSION,
		id: document.identity.sessionId,
		timestamp: new Date(document.identity.createdAt).toISOString(),
		cwd: document.identity.cwd ?? "",
		parentSession: document.identity.parentSessionPath,
		parentEntryId: document.identity.parentEntryId,
	};
}

function toSessionEntry(entry: ConversationDocumentEntry): SessionEntry {
	switch (entry.type) {
		case "message":
			return { ...entry, message: entry.message as AgentMessage };
		case "custom_message":
			return (
				restoreCodingAgentSessionAgentMessageEntry(entry) ?? {
					...entry,
					content: entry.content as CustomMessageEntry["content"],
				}
			);
		case "tool_timing":
			return { ...entry, phases: [...entry.phases] };
		case "label":
			return { ...entry, label: entry.label };
		case "compaction": {
			const { reason: _reason, summaryMessage: _summaryMessage, ...legacyEntry } = entry;
			return legacyEntry;
		}
		default:
			return { ...entry };
	}
}
