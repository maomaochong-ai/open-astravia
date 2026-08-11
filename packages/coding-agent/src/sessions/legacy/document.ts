import { readFileSync } from "node:fs";
import type { AgentMessage } from "@vetta/agent-core";
import type { ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import { parseLegacySessionDocumentSource } from "@vetta/runtime-storage/conversation";
import type {
	CodingAgentCustomMessageEntry,
	CodingAgentSessionEntry,
	CodingAgentSessionHeader,
} from "../contracts/session-entry.js";
import {
	normalizeCodingAgentLegacySessionEntry,
	restoreCodingAgentSessionAgentMessageEntry,
} from "./entry-normalizer.js";

export interface CodingAgentLegacySessionDocument {
	readonly header: CodingAgentSessionHeader;
	readonly entries: readonly CodingAgentSessionEntry[];
	readonly activeLeafId: string | null;
}

export function readCodingAgentLegacySessionDocument(sessionPath: string): CodingAgentLegacySessionDocument {
	return parseCodingAgentLegacySessionDocument(readFileSync(sessionPath, "utf8"));
}

export function parseCodingAgentLegacySessionDocument(content: string): CodingAgentLegacySessionDocument {
	const normalizedContent = normalizeLegacySessionContent(content);
	const source = parseLegacySessionDocumentSource(normalizedContent);
	const document = source.document;
	return {
		header: {
			type: "session",
			version: source.formatVersion,
			id: document.identity.sessionId,
			timestamp:
				readLegacySessionHeaderTimestamp(normalizedContent) ?? new Date(document.identity.createdAt).toISOString(),
			cwd: document.identity.cwd ?? "",
			parentSession: document.identity.parentSessionPath,
			parentEntryId: document.identity.parentEntryId,
		},
		entries: document.entries.map(toCodingAgentSessionEntry),
		activeLeafId: document.activeLeafId,
	};
}

function readLegacySessionHeaderTimestamp(content: string): string | undefined {
	for (const line of content.split(/\r?\n/u)) {
		if (!line.trim()) continue;
		try {
			const value: unknown = JSON.parse(line);
			if (typeof value !== "object" || value === null || Reflect.get(value, "type") !== "session") {
				return undefined;
			}
			const timestamp = Reflect.get(value, "timestamp");
			return typeof timestamp === "string" ? timestamp : undefined;
		} catch {
			// The Legacy reader skips malformed lines before locating its header.
		}
	}
	return undefined;
}

function normalizeLegacySessionContent(content: string): string {
	return content
		.split(/\r?\n/u)
		.map((line) => {
			if (!line.trim()) return line;
			try {
				const value: unknown = JSON.parse(line);
				if (typeof value !== "object" || value === null || Reflect.get(value, "type") === "session") return line;
				return JSON.stringify(normalizeCodingAgentLegacySessionEntry(value as Readonly<Record<string, unknown>>));
			} catch {
				return line;
			}
		})
		.join("\n");
}

function toCodingAgentSessionEntry(entry: ConversationDocumentEntry): CodingAgentSessionEntry {
	switch (entry.type) {
		case "message":
			return { ...entry, message: entry.message as AgentMessage };
		case "custom_message":
			return (
				restoreCodingAgentSessionAgentMessageEntry(entry) ?? {
					...entry,
					content: entry.content as CodingAgentCustomMessageEntry["content"],
				}
			);
		case "tool_timing":
			return { ...entry, phases: [...entry.phases] };
		case "label":
			return { ...entry, label: entry.label };
		case "compaction": {
			const { reason: _reason, summaryMessage: _summaryMessage, ...sessionEntry } = entry;
			return sessionEntry;
		}
		default:
			return { ...entry };
	}
}
