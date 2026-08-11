import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type {
	ConversationDocument,
	ConversationDocumentCompactionEntry,
	ConversationDocumentEntry,
	ConversationDocumentEntryBase,
	ConversationDocumentReader,
} from "@vetta/runtime-core/conversation";

const LegacyHeaderSchema = Type.Object(
	{
		type: Type.Literal("session"),
		version: Type.Optional(Type.Number()),
		id: Type.String(),
		timestamp: Type.String(),
		cwd: Type.Optional(Type.String()),
		parentSession: Type.Optional(Type.String()),
		parentEntryId: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

const LegacyEntryEnvelopeSchema = Type.Object(
	{
		type: Type.String(),
		id: Type.Optional(Type.String()),
		parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		timestamp: Type.String(),
	},
	{ additionalProperties: true },
);

export interface LegacySessionDocumentReaderOptions {
	readonly resolvePath: (sessionId: string) => string;
}

export interface LegacySessionDocumentSource {
	readonly document: ConversationDocument;
	readonly formatVersion: number;
}

/** Read-only importer for coding-agent JSONL v1-v3 files. It never rewrites the source file. */
export class LegacySessionDocumentReader implements ConversationDocumentReader {
	private readonly resolvePath: (sessionId: string) => string;

	constructor(options: LegacySessionDocumentReaderOptions) {
		this.resolvePath = options.resolvePath;
	}

	async readDocument(sessionId: string): Promise<ConversationDocument> {
		const document = await readLegacySessionDocument(this.resolvePath(sessionId));
		if (document.identity.sessionId !== sessionId) {
			throw new Error(`Legacy session ${document.identity.sessionId} does not match ${sessionId}`);
		}
		return document;
	}
}

export async function readLegacySessionDocument(path: string): Promise<ConversationDocument> {
	return (await readLegacySessionDocumentSource(path)).document;
}

export async function readLegacySessionDocumentSource(path: string): Promise<LegacySessionDocumentSource> {
	return parseLegacySessionDocumentSource(await readFile(path, "utf8"));
}

export function parseLegacySessionDocument(content: string): ConversationDocument {
	return parseLegacySessionDocumentSource(content).document;
}

export function parseLegacySessionDocumentSource(content: string): LegacySessionDocumentSource {
	const records = parseJsonLines(content);
	const header = records[0];
	if (!Value.Check(LegacyHeaderSchema, header)) {
		throw new Error("Legacy session is missing a valid header");
	}

	const entries: ConversationDocumentEntry[] = [];
	let previousId: string | null = null;
	for (let index = 1; index < records.length; index += 1) {
		const record = records[index];
		if (!Value.Check(LegacyEntryEnvelopeSchema, record)) continue;
		const base = normalizeEntryBase(record, index, previousId, header.version ?? 1);
		const entry = parseEntry(record, base);
		if (!entry) continue;
		entries.push(entry);
		previousId = entry.id;
	}

	return {
		formatVersion: header.version ?? 1,
		document: {
			identity: {
				sessionId: header.id,
				createdAt: parseTimestamp(header.timestamp),
				cwd: header.cwd,
				parentSessionPath: header.parentSession,
				parentEntryId: header.parentEntryId,
			},
			journalVersion: 0,
			revision: entries.length,
			entries,
			activeLeafId: findActiveLeafId(entries),
			name: findSessionName(entries),
		},
	};
}

function parseJsonLines(content: string): unknown[] {
	const records: unknown[] = [];
	for (const line of content.trim().split("\n")) {
		if (!line.trim()) continue;
		try {
			records.push(JSON.parse(line) as unknown);
		} catch {
			// Matches the Legacy reader: malformed lines are ignored.
		}
	}
	return records;
}

function normalizeEntryBase(
	record: Record<string, unknown>,
	lineIndex: number,
	previousId: string | null,
	version: number,
): ConversationDocumentEntryBase {
	const id = version >= 2 && typeof record.id === "string" ? record.id : `legacy-${lineIndex}`;
	const parentId =
		version >= 2 && (typeof record.parentId === "string" || record.parentId === null) ? record.parentId : previousId;
	return {
		id,
		parentId,
		timestamp: record.timestamp as string,
	};
}

function parseEntry(
	record: Record<string, unknown>,
	base: ConversationDocumentEntryBase,
): ConversationDocumentEntry | undefined {
	switch (record.type) {
		case "message":
			return "message" in record ? { ...base, type: "message", message: record.message } : undefined;
		case "thinking_level_change":
			return typeof record.thinkingLevel === "string"
				? { ...base, type: "thinking_level_change", thinkingLevel: record.thinkingLevel }
				: undefined;
		case "model_change":
			return typeof record.provider === "string" && typeof record.modelId === "string"
				? { ...base, type: "model_change", provider: record.provider, modelId: record.modelId }
				: undefined;
		case "compaction":
			return typeof record.summary === "string" && typeof record.tokensBefore === "number"
				? {
						...base,
						type: "compaction",
						summary: record.summary,
						firstKeptEntryId: typeof record.firstKeptEntryId === "string" ? record.firstKeptEntryId : "",
						tokensBefore: record.tokensBefore,
						details: record.details,
						fromHook: typeof record.fromHook === "boolean" ? record.fromHook : undefined,
						summaryMessage: isRecord(record.summaryMessage)
							? (record.summaryMessage as unknown as ConversationDocumentCompactionEntry["summaryMessage"])
							: undefined,
					}
				: undefined;
		case "branch_summary":
			return typeof record.fromId === "string" && typeof record.summary === "string"
				? {
						...base,
						type: "branch_summary",
						fromId: record.fromId,
						summary: record.summary,
						details: record.details,
						fromHook: typeof record.fromHook === "boolean" ? record.fromHook : undefined,
					}
				: undefined;
		case "custom":
			return typeof record.customType === "string"
				? { ...base, type: "custom", customType: record.customType, data: record.data }
				: undefined;
		case "custom_message":
			return typeof record.customType === "string" && typeof record.display === "boolean"
				? {
						...base,
						type: "custom_message",
						customType: record.customType,
						content: record.content,
						details: record.details,
						display: record.display,
						modelVisible: typeof record.modelVisible === "boolean" ? record.modelVisible : undefined,
					}
				: undefined;
		case "label":
			return typeof record.targetId === "string"
				? {
						...base,
						type: "label",
						targetId: record.targetId,
						label: typeof record.label === "string" ? record.label : undefined,
					}
				: undefined;
		case "session_info":
			return {
				...base,
				type: "session_info",
				name: typeof record.name === "string" ? record.name : undefined,
			};
		case "tool_timing": {
			const phases = parseToolPhases(record.phases);
			return typeof record.toolCallId === "string" &&
				typeof record.toolName === "string" &&
				typeof record.startedAt === "number" &&
				typeof record.durationMs === "number" &&
				phases
				? {
						...base,
						type: "tool_timing",
						toolCallId: record.toolCallId,
						toolName: record.toolName,
						startedAt: record.startedAt,
						durationMs: record.durationMs,
						phases,
					}
				: undefined;
		}
		default:
			return undefined;
	}
}

function parseToolPhases(value: unknown): Array<{ readonly label: string; readonly atMs: number }> | undefined {
	if (!Array.isArray(value)) return undefined;
	const phases: Array<{ readonly label: string; readonly atMs: number }> = [];
	for (const phase of value) {
		if (!isRecord(phase) || typeof phase.label !== "string" || typeof phase.atMs !== "number") return undefined;
		phases.push({ label: phase.label, atMs: phase.atMs });
	}
	return phases;
}

function findActiveLeafId(entries: readonly ConversationDocumentEntry[]): string | null {
	const hasChild = new Set(entries.flatMap((entry) => (entry.parentId ? [entry.parentId] : [])));
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry && !hasChild.has(entry.id)) return entry.id;
	}
	return null;
}

function findSessionName(entries: readonly ConversationDocumentEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "session_info") return entry.name;
	}
	return undefined;
}

function parseTimestamp(value: string): number {
	const timestamp = new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
