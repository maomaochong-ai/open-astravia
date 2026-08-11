import { type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ConversationDocumentEntry } from "@vetta/runtime-core/conversation";
import { CONVERSATION_STORAGE_ERROR_CODES, ConversationStorageError } from "./errors.js";
import {
	type LegacySessionDocumentSource,
	parseLegacySessionDocumentSource,
} from "./legacy-session-document-reader.js";
import { ConversationMessageSchema, UserMessageSchema } from "./record-schema.js";

export type LegacySessionImportEntryNormalizer = (
	entry: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, unknown>>;

export interface LegacySessionImportAnalyzerOptions {
	readonly entryNormalizer?: LegacySessionImportEntryNormalizer;
}

export type LegacySessionImportIssueCode =
	| "malformed-json"
	| "invalid-header"
	| "invalid-envelope"
	| "unsupported-record"
	| "invalid-payload"
	| "duplicate-entry-id"
	| "broken-parent-reference"
	| "cyclic-parent-reference"
	| "invalid-entry-reference";

export interface LegacySessionImportIssue {
	readonly line: number;
	readonly code: LegacySessionImportIssueCode;
	readonly recordType?: string;
}

interface LegacySessionImportAnalysisBase {
	readonly recordCount: number;
	readonly sourceVersion?: number;
}

export interface RepresentableLegacySessionImportAnalysis extends LegacySessionImportAnalysisBase {
	readonly status: "representable";
	readonly sourceVersion: number;
	readonly issues: readonly [];
	readonly source: LegacySessionDocumentSource;
}

export interface UnrepresentableLegacySessionImportAnalysis extends LegacySessionImportAnalysisBase {
	readonly status: "not-representable";
	readonly issues: readonly LegacySessionImportIssue[];
}

export type LegacySessionImportAnalysis =
	| RepresentableLegacySessionImportAnalysis
	| UnrepresentableLegacySessionImportAnalysis;

export class LegacySessionImportError extends ConversationStorageError {
	readonly analysis: UnrepresentableLegacySessionImportAnalysis;

	constructor(analysis: UnrepresentableLegacySessionImportAnalysis) {
		const firstIssue = analysis.issues[0];
		super(
			CONVERSATION_STORAGE_ERROR_CODES.CORRUPT,
			`Legacy session import is not representable${firstIssue ? `: ${firstIssue.code} at line ${firstIssue.line}` : ""}`,
		);
		this.name = "LegacySessionImportError";
		this.analysis = analysis;
	}
}

const LegacyHeaderSchema = Type.Object(
	{
		type: Type.Literal("session"),
		version: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
		id: Type.String({ minLength: 1 }),
		timestamp: Type.String({ minLength: 1 }),
		cwd: Type.Optional(Type.String()),
		parentSession: Type.Optional(Type.String()),
		parentEntryId: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const entryBaseProperties = {
	id: Type.Optional(Type.String({ minLength: 1 })),
	parentId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
	timestamp: Type.String({ minLength: 1 }),
};

const LegacyEntryEnvelopeSchema = Type.Object(
	{
		type: Type.String({ minLength: 1 }),
		...entryBaseProperties,
	},
	{ additionalProperties: true },
);

const knownEntrySchemas: Readonly<Record<string, TSchema>> = {
	message: Type.Object(
		{ type: Type.Literal("message"), ...entryBaseProperties, message: ConversationMessageSchema },
		{ additionalProperties: false },
	),
	thinking_level_change: Type.Object(
		{ type: Type.Literal("thinking_level_change"), ...entryBaseProperties, thinkingLevel: Type.String() },
		{ additionalProperties: false },
	),
	model_change: Type.Object(
		{
			type: Type.Literal("model_change"),
			...entryBaseProperties,
			provider: Type.String(),
			modelId: Type.String(),
		},
		{ additionalProperties: false },
	),
	compaction: Type.Object(
		{
			type: Type.Literal("compaction"),
			...entryBaseProperties,
			summary: Type.String(),
			firstKeptEntryId: Type.String({ minLength: 1 }),
			tokensBefore: Type.Number({ minimum: 0 }),
			details: Type.Optional(Type.Unknown()),
			fromHook: Type.Optional(Type.Boolean()),
			summaryMessage: Type.Optional(UserMessageSchema),
		},
		{ additionalProperties: false },
	),
	branch_summary: Type.Object(
		{
			type: Type.Literal("branch_summary"),
			...entryBaseProperties,
			fromId: Type.String({ minLength: 1 }),
			summary: Type.String(),
			details: Type.Optional(Type.Unknown()),
			fromHook: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
	custom: Type.Object(
		{
			type: Type.Literal("custom"),
			...entryBaseProperties,
			customType: Type.String({ minLength: 1 }),
			data: Type.Optional(Type.Unknown()),
		},
		{ additionalProperties: false },
	),
	custom_message: Type.Object(
		{
			type: Type.Literal("custom_message"),
			...entryBaseProperties,
			customType: Type.String({ minLength: 1 }),
			content: Type.Unknown(),
			details: Type.Optional(Type.Unknown()),
			display: Type.Boolean(),
			modelVisible: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
	label: Type.Object(
		{
			type: Type.Literal("label"),
			...entryBaseProperties,
			targetId: Type.String({ minLength: 1 }),
			label: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	session_info: Type.Object(
		{
			type: Type.Literal("session_info"),
			...entryBaseProperties,
			name: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	tool_timing: Type.Object(
		{
			type: Type.Literal("tool_timing"),
			...entryBaseProperties,
			toolCallId: Type.String({ minLength: 1 }),
			toolName: Type.String({ minLength: 1 }),
			startedAt: Type.Number(),
			durationMs: Type.Number({ minimum: 0 }),
			phases: Type.Array(
				Type.Object({ label: Type.String(), atMs: Type.Number({ minimum: 0 }) }, { additionalProperties: false }),
			),
		},
		{ additionalProperties: false },
	),
};

interface ParsedLine {
	readonly line: number;
	readonly value: unknown;
}

/** Strict, read-only preflight for automatic Legacy-to-V2 imports. */
export function analyzeLegacySessionImport(
	content: string,
	options: LegacySessionImportAnalyzerOptions = {},
): LegacySessionImportAnalysis {
	const parsedLines: ParsedLine[] = [];
	const issues: LegacySessionImportIssue[] = [];
	let recordCount = 0;
	for (const [index, text] of content.split(/\r?\n/u).entries()) {
		if (!text.trim()) continue;
		recordCount += 1;
		try {
			parsedLines.push({ line: index + 1, value: JSON.parse(text) as unknown });
		} catch {
			issues.push({ line: index + 1, code: "malformed-json" });
		}
	}

	const headerLine = parsedLines[0];
	if (!headerLine || !Value.Check(LegacyHeaderSchema, headerLine.value)) {
		issues.push({ line: headerLine?.line ?? 1, code: "invalid-header" });
		return notRepresentable(recordCount, issues, readHeaderVersion(headerLine?.value));
	}
	const header = headerLine.value;
	const sourceVersion = header.version ?? 1;
	if (!isValidTimestamp(header.timestamp)) {
		issues.push({ line: headerLine.line, code: "invalid-header", recordType: "session" });
	}

	const entryLines: ParsedLine[] = [];
	for (const parsed of parsedLines.slice(1)) {
		if (!Value.Check(LegacyEntryEnvelopeSchema, parsed.value)) {
			issues.push({ line: parsed.line, code: "invalid-envelope", recordType: readRecordType(parsed.value) });
			continue;
		}
		const original = parsed.value;
		const originalRecordType = original.type;
		if (!knownEntrySchemas[originalRecordType]) {
			issues.push({ line: parsed.line, code: "unsupported-record", recordType: originalRecordType });
			continue;
		}
		let normalized: Readonly<Record<string, unknown>> = original;
		try {
			normalized = options.entryNormalizer?.(original) ?? original;
		} catch {
			issues.push({ line: parsed.line, code: "invalid-payload", recordType: originalRecordType });
			continue;
		}
		if (!Value.Check(LegacyEntryEnvelopeSchema, normalized) || !hasSameEntryIdentity(original, normalized)) {
			issues.push({ line: parsed.line, code: "invalid-payload", recordType: originalRecordType });
			continue;
		}
		const recordType = normalized.type;
		const schema = knownEntrySchemas[recordType];
		if (!schema) {
			issues.push({ line: parsed.line, code: "invalid-payload", recordType: originalRecordType });
			continue;
		}
		if (!Value.Check(schema, normalized) || !isValidTimestamp(normalized.timestamp)) {
			issues.push({ line: parsed.line, code: "invalid-payload", recordType: originalRecordType });
			continue;
		}
		if (sourceVersion >= 2 && (normalized.id === undefined || normalized.parentId === undefined)) {
			issues.push({ line: parsed.line, code: "invalid-envelope", recordType: originalRecordType });
			continue;
		}
		entryLines.push({ line: parsed.line, value: normalized });
	}

	if (issues.length > 0) return notRepresentable(recordCount, issues, sourceVersion);

	const normalizedContent = [headerLine.value, ...entryLines.map(({ value }) => value)]
		.map((record) => JSON.stringify(record))
		.join("\n");
	const source = parseLegacySessionDocumentSource(normalizedContent);
	if (source.document.entries.length !== entryLines.length) {
		return notRepresentable(
			recordCount,
			[{ line: headerLine.line, code: "invalid-payload", recordType: "session" }],
			sourceVersion,
		);
	}
	const semanticIssues = validateReferences(source.document.entries, entryLines);
	if (semanticIssues.length > 0) {
		return notRepresentable(recordCount, semanticIssues, sourceVersion);
	}
	return {
		status: "representable",
		recordCount,
		sourceVersion,
		issues: [],
		source,
	};
}

function validateReferences(
	entries: readonly ConversationDocumentEntry[],
	lines: readonly ParsedLine[],
): LegacySessionImportIssue[] {
	const issues: LegacySessionImportIssue[] = [];
	const byId = new Map<string, ConversationDocumentEntry>();
	const lineById = new Map<string, number>();
	for (const [index, entry] of entries.entries()) {
		const line = lines[index]?.line ?? index + 2;
		if (byId.has(entry.id)) {
			issues.push({ line, code: "duplicate-entry-id", recordType: entry.type });
			continue;
		}
		byId.set(entry.id, entry);
		lineById.set(entry.id, line);
	}
	for (const entry of entries) {
		const line = lineById.get(entry.id) ?? 1;
		if (entry.parentId && !byId.has(entry.parentId)) {
			issues.push({ line, code: "broken-parent-reference", recordType: entry.type });
			continue;
		}
		const ancestors = new Set<string>([entry.id]);
		let parentId = entry.parentId;
		while (parentId) {
			if (ancestors.has(parentId)) {
				issues.push({ line, code: "cyclic-parent-reference", recordType: entry.type });
				break;
			}
			ancestors.add(parentId);
			parentId = byId.get(parentId)?.parentId ?? null;
		}
		const referencedId = readEntryReference(entry);
		if (referencedId && !byId.has(referencedId)) {
			issues.push({ line, code: "invalid-entry-reference", recordType: entry.type });
		}
	}
	return issues;
}

function readEntryReference(entry: ConversationDocumentEntry): string | undefined {
	switch (entry.type) {
		case "compaction":
			return entry.firstKeptEntryId;
		case "branch_summary":
			return entry.fromId;
		case "label":
			return entry.targetId;
		default:
			return undefined;
	}
}

function notRepresentable(
	recordCount: number,
	issues: readonly LegacySessionImportIssue[],
	sourceVersion?: number,
): UnrepresentableLegacySessionImportAnalysis {
	return {
		status: "not-representable",
		recordCount,
		...(sourceVersion === undefined ? {} : { sourceVersion }),
		issues,
	};
}

function isValidTimestamp(value: string): boolean {
	return Number.isFinite(new Date(value).getTime());
}

function readRecordType(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const type = Reflect.get(value, "type");
	return typeof type === "string" ? type : undefined;
}

function readHeaderVersion(value: unknown): number | undefined {
	if (typeof value !== "object" || value === null || Reflect.get(value, "type") !== "session") return undefined;
	const version = Reflect.get(value, "version");
	return Number.isInteger(version) ? (version as number) : undefined;
}

function hasSameEntryIdentity(
	original: Readonly<Record<string, unknown>>,
	normalized: Readonly<Record<string, unknown>>,
): boolean {
	return (
		normalized.id === original.id &&
		normalized.parentId === original.parentId &&
		normalized.timestamp === original.timestamp
	);
}
