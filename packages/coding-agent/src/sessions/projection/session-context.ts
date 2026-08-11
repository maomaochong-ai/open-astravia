import type { AgentMessage } from "@vetta/agent-core";
import {
	createBranchSummaryMessage,
	createCompactionSummaryMessage,
	createCustomMessage,
} from "../../model-context/index.js";
import type {
	CodingAgentCompactionEntry,
	CodingAgentSessionContext,
	CodingAgentSessionEntry,
} from "../contracts/session-entry.js";

export interface CodingAgentSessionContextProjectionItem {
	readonly message: AgentMessage;
	readonly entry: CodingAgentSessionEntry;
}

export interface CodingAgentSessionContextProjection {
	readonly items: readonly CodingAgentSessionContextProjectionItem[];
	readonly thinkingLevel: string;
	readonly model: { readonly provider: string; readonly modelId: string } | null;
}

export function latestCodingAgentCompaction(
	entries: readonly CodingAgentSessionEntry[],
): CodingAgentCompactionEntry | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "compaction") return entry;
	}
	return null;
}

export function projectCodingAgentSessionContext(
	entries: CodingAgentSessionEntry[],
	leafId?: string | null,
	byId?: Map<string, CodingAgentSessionEntry>,
): CodingAgentSessionContext {
	const projection = projectCodingAgentSessionContextEntries(entries, leafId, byId);
	return {
		messages: projection.items.map(({ message }) => message),
		thinkingLevel: projection.thinkingLevel,
		model: projection.model,
	};
}

export function projectCodingAgentSessionContextEntries(
	entries: CodingAgentSessionEntry[],
	leafId?: string | null,
	byId: Map<string, CodingAgentSessionEntry> = new Map(entries.map((entry) => [entry.id, entry])),
): CodingAgentSessionContextProjection {
	if (leafId === null) return emptyProjection();
	const leaf = leafId ? byId.get(leafId) : entries.at(-1);
	if (!leaf) return emptyProjection();

	const path: CodingAgentSessionEntry[] = [];
	let current: CodingAgentSessionEntry | undefined = leaf;
	while (current) {
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}

	let thinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;
	let compaction: CodingAgentCompactionEntry | null = null;
	for (const entry of path) {
		if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
		else if (entry.type === "model_change") model = { provider: entry.provider, modelId: entry.modelId };
		else if (entry.type === "message" && entry.message.role === "assistant") {
			model = { provider: entry.message.provider, modelId: entry.message.model };
		} else if (entry.type === "compaction") compaction = entry;
	}

	const items: CodingAgentSessionContextProjectionItem[] = [];
	const appendVisible = (entry: CodingAgentSessionEntry): void => {
		if (entry.type === "message") items.push({ message: entry.message, entry });
		else if (entry.type === "custom_message") {
			items.push({
				message: createCustomMessage(
					entry.customType,
					entry.content,
					entry.display,
					entry.details,
					entry.timestamp,
				),
				entry,
			});
		} else if (entry.type === "branch_summary" && entry.summary) {
			items.push({ message: createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp), entry });
		}
	};

	if (!compaction) {
		for (const entry of path) appendVisible(entry);
		return { items, thinkingLevel, model };
	}

	items.push({
		message: createCompactionSummaryMessage(compaction.summary, compaction.tokensBefore, compaction.timestamp),
		entry: compaction,
	});
	const compactionIndex = path.findIndex((entry) => entry.id === compaction.id);
	let foundFirstKept = false;
	for (let index = 0; index < compactionIndex; index += 1) {
		const entry = path[index];
		if (!entry) continue;
		if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
		if (foundFirstKept) appendVisible(entry);
	}
	for (let index = compactionIndex + 1; index < path.length; index += 1) {
		const entry = path[index];
		if (entry) appendVisible(entry);
	}
	return { items, thinkingLevel, model };
}

function emptyProjection(): CodingAgentSessionContextProjection {
	return { items: [], thinkingLevel: "off", model: null };
}
