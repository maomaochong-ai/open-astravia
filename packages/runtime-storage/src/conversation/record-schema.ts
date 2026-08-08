import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const LEGACY_CONVERSATION_SCHEMA_VERSION = 1;
export const CONVERSATION_SCHEMA_VERSION = 2;

const TextContentSchema = Type.Object(
	{
		type: Type.Literal("text"),
		text: Type.String(),
		textSignature: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const ImageContentSchema = Type.Object(
	{
		type: Type.Literal("image"),
		data: Type.String(),
		mimeType: Type.String(),
	},
	{ additionalProperties: false },
);

const ThinkingContentSchema = Type.Object(
	{
		type: Type.Literal("thinking"),
		thinking: Type.String(),
		thinkingSignature: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const ToolCallSchema = Type.Object(
	{
		type: Type.Literal("toolCall"),
		id: Type.String(),
		name: Type.String(),
		arguments: Type.Record(Type.String(), Type.Unknown()),
		thoughtSignature: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const CostSchema = Type.Object(
	{
		input: Type.Number(),
		output: Type.Number(),
		cacheRead: Type.Number(),
		cacheWrite: Type.Number(),
		total: Type.Number(),
	},
	{ additionalProperties: false },
);

const UsageSchema = Type.Object(
	{
		input: Type.Number(),
		output: Type.Number(),
		cacheRead: Type.Number(),
		cacheWrite: Type.Number(),
		totalTokens: Type.Number(),
		cost: CostSchema,
	},
	{ additionalProperties: false },
);

const StopReasonSchema = Type.Union([
	Type.Literal("stop"),
	Type.Literal("length"),
	Type.Literal("toolUse"),
	Type.Literal("error"),
	Type.Literal("aborted"),
]);

export const UserMessageSchema = Type.Object(
	{
		role: Type.Literal("user"),
		content: Type.Union([Type.String(), Type.Array(Type.Union([TextContentSchema, ImageContentSchema]))]),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const AssistantMessageSchema = Type.Object(
	{
		role: Type.Literal("assistant"),
		content: Type.Array(Type.Union([TextContentSchema, ThinkingContentSchema, ToolCallSchema])),
		api: Type.String(),
		provider: Type.String(),
		model: Type.String(),
		usage: UsageSchema,
		stopReason: StopReasonSchema,
		errorMessage: Type.Optional(Type.String()),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const ToolResultMessageSchema = Type.Object(
	{
		role: Type.Literal("toolResult"),
		toolCallId: Type.String(),
		toolName: Type.String(),
		content: Type.Array(Type.Union([TextContentSchema, ImageContentSchema])),
		details: Type.Optional(Type.Unknown()),
		isError: Type.Boolean(),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

export const ConversationMessageSchema = Type.Union([
	UserMessageSchema,
	AssistantMessageSchema,
	ToolResultMessageSchema,
]);

const LegacyCompactionRecordSchema = Type.Object(
	{
		id: Type.String(),
		sourceMessageCount: Type.Integer({ minimum: 0 }),
		resultMessageCount: Type.Integer({ minimum: 0 }),
		summary: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const ContextCompactionRecordSchema = Type.Object(
	{
		summary: Type.String(),
		summaryMessage: UserMessageSchema,
		firstKeptEntryId: Type.String(),
		tokensBefore: Type.Number({ minimum: 0 }),
		details: Type.Optional(Type.Unknown()),
		fromHook: Type.Optional(Type.Boolean()),
		reason: Type.Union([Type.Literal("manual"), Type.Literal("threshold"), Type.Literal("overflow")]),
	},
	{ additionalProperties: false },
);

const CompactionRecordSchema = Type.Union([LegacyCompactionRecordSchema, ContextCompactionRecordSchema]);

const TurnStartedEventSchema = Type.Object(
	{
		type: Type.Literal("turn.started"),
		sessionId: Type.String(),
		turnId: Type.String(),
		snapshotId: Type.String(),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const TurnContinuedEventSchema = Type.Object(
	{
		type: Type.Literal("turn.continued"),
		sessionId: Type.String(),
		turnId: Type.String(),
		sourceSessionId: Type.String(),
		snapshotId: Type.String(),
		reason: Type.String(),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const RuntimeMessageOriginSchema = Type.Object(
	{
		kind: Type.Literal("continuation"),
		source: Type.String(),
	},
	{ additionalProperties: false },
);

const MessageAppendedEventSchema = Type.Object(
	{
		type: Type.Literal("message.appended"),
		sessionId: Type.String(),
		turnId: Type.String(),
		message: ConversationMessageSchema,
		origin: Type.Optional(RuntimeMessageOriginSchema),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const SessionContextRecordSchema = Type.Object(
	{
		type: Type.String(),
		content: Type.Union([Type.String(), Type.Array(Type.Union([TextContentSchema, ImageContentSchema]))]),
		modelVisible: Type.Boolean(),
		display: Type.Optional(Type.Boolean()),
		metadata: Type.Optional(Type.Unknown()),
		timestamp: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);

const ContextAppendedEventSchema = Type.Object(
	{
		type: Type.Literal("context.appended"),
		sessionId: Type.String(),
		turnId: Type.String(),
		record: SessionContextRecordSchema,
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const ContextRecordedEventSchema = Type.Object(
	{
		type: Type.Literal("context.recorded"),
		sessionId: Type.String(),
		turnId: Type.Optional(Type.Never()),
		record: SessionContextRecordSchema,
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const ContextCompactedEventSchema = Type.Object(
	{
		type: Type.Literal("context.compacted"),
		sessionId: Type.String(),
		turnId: Type.Optional(Type.String()),
		record: CompactionRecordSchema,
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const TurnCompletedEventSchema = Type.Object(
	{
		type: Type.Literal("turn.completed"),
		sessionId: Type.String(),
		turnId: Type.String(),
		stopReason: StopReasonSchema,
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const TurnCancelledEventSchema = Type.Object(
	{
		type: Type.Literal("turn.cancelled"),
		sessionId: Type.String(),
		turnId: Type.String(),
		reason: Type.Optional(Type.String()),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const TurnFailedEventSchema = Type.Object(
	{
		type: Type.Literal("turn.failed"),
		sessionId: Type.String(),
		turnId: Type.String(),
		error: Type.Object(
			{
				code: Type.String(),
				message: Type.String(),
			},
			{ additionalProperties: false },
		),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

const TurnTransferredEventSchema = Type.Object(
	{
		type: Type.Literal("turn.transferred"),
		sessionId: Type.String(),
		turnId: Type.String(),
		targetSessionId: Type.String(),
		reason: Type.String(),
		timestamp: Type.Number(),
	},
	{ additionalProperties: false },
);

export const StoredSessionEventSchema = Type.Union([
	TurnStartedEventSchema,
	TurnContinuedEventSchema,
	MessageAppendedEventSchema,
	ContextAppendedEventSchema,
	ContextRecordedEventSchema,
	ContextCompactedEventSchema,
	TurnCompletedEventSchema,
	TurnCancelledEventSchema,
	TurnFailedEventSchema,
	TurnTransferredEventSchema,
]);

const ConversationFileHeaderSchemaV1 = Type.Object(
	{
		recordType: Type.Literal("conversation.header"),
		schemaVersion: Type.Literal(LEGACY_CONVERSATION_SCHEMA_VERSION),
		sessionId: Type.String(),
		createdAt: Type.Number(),
	},
	{ additionalProperties: false },
);

export const CurrentConversationFileHeaderSchema = Type.Object(
	{
		recordType: Type.Literal("conversation.header"),
		schemaVersion: Type.Literal(CONVERSATION_SCHEMA_VERSION),
		sessionId: Type.String(),
		createdAt: Type.Number(),
		cwd: Type.Optional(Type.String()),
		parentSessionPath: Type.Optional(Type.String()),
		parentEntryId: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export const ConversationFileHeaderSchema = Type.Union([
	ConversationFileHeaderSchemaV1,
	CurrentConversationFileHeaderSchema,
]);

const ConversationEventRecordSchemaV1 = Type.Object(
	{
		recordType: Type.Literal("conversation.event"),
		schemaVersion: Type.Literal(LEGACY_CONVERSATION_SCHEMA_VERSION),
		sequence: Type.Integer({ minimum: 1 }),
		event: StoredSessionEventSchema,
	},
	{ additionalProperties: false },
);

export const ConversationDocumentEntryReferenceSchema = Type.Object(
	{
		id: Type.String(),
		parentId: Type.Union([Type.String(), Type.Null()]),
		timestamp: Type.String(),
	},
	{ additionalProperties: false },
);

export const CurrentConversationEventRecordSchema = Type.Object(
	{
		recordType: Type.Literal("conversation.event"),
		schemaVersion: Type.Literal(CONVERSATION_SCHEMA_VERSION),
		sequence: Type.Integer({ minimum: 1 }),
		event: StoredSessionEventSchema,
		documentEntry: Type.Union([ConversationDocumentEntryReferenceSchema, Type.Null()]),
	},
	{ additionalProperties: false },
);

export const ConversationEventRecordSchema = Type.Union([
	ConversationEventRecordSchemaV1,
	CurrentConversationEventRecordSchema,
]);

export const ConversationDocumentCommandSchema = Type.Union([
	Type.Object(
		{
			type: Type.Literal("active_leaf.set"),
			entryId: Type.Union([Type.String(), Type.Null()]),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("branch.select"),
			entryId: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("message.delete"),
			entryId: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("user_turn.replace"),
			entryId: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("branch_summary.append"),
			entryId: Type.String(),
			parentId: Type.Union([Type.String(), Type.Null()]),
			summary: Type.String(),
			details: Type.Optional(Type.Unknown()),
			fromHook: Type.Optional(Type.Boolean()),
			timestamp: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("custom.append"),
			entryId: Type.String(),
			customType: Type.String(),
			data: Type.Optional(Type.Unknown()),
			timestamp: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("session.name.set"),
			name: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("entry.label.set"),
			entryId: Type.String(),
			targetId: Type.String(),
			label: Type.Optional(Type.String()),
			timestamp: Type.String(),
		},
		{ additionalProperties: false },
	),
]);

export const ConversationDocumentOperationRecordSchema = Type.Object(
	{
		recordType: Type.Literal("conversation.document.operation"),
		schemaVersion: Type.Literal(CONVERSATION_SCHEMA_VERSION),
		revision: Type.Integer({ minimum: 1 }),
		command: ConversationDocumentCommandSchema,
	},
	{ additionalProperties: false },
);

const ConversationDocumentEntryBaseSchema = {
	id: Type.String(),
	parentId: Type.Union([Type.String(), Type.Null()]),
	timestamp: Type.String(),
};

const ToolPhaseSchema = Type.Object(
	{
		label: Type.String(),
		atMs: Type.Number(),
	},
	{ additionalProperties: false },
);

export const ConversationDocumentEntrySchema = Type.Union([
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("message"),
			message: ConversationMessageSchema,
			origin: Type.Optional(RuntimeMessageOriginSchema),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("compaction"),
			summary: Type.String(),
			firstKeptEntryId: Type.String(),
			tokensBefore: Type.Number({ minimum: 0 }),
			details: Type.Optional(Type.Unknown()),
			fromHook: Type.Optional(Type.Boolean()),
			summaryMessage: Type.Optional(UserMessageSchema),
			reason: Type.Optional(
				Type.Union([Type.Literal("manual"), Type.Literal("threshold"), Type.Literal("overflow")]),
			),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("branch_summary"),
			fromId: Type.String(),
			summary: Type.String(),
			details: Type.Optional(Type.Unknown()),
			fromHook: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("custom"),
			customType: Type.String(),
			data: Type.Optional(Type.Unknown()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("custom_message"),
			customType: Type.String(),
			content: Type.Unknown(),
			details: Type.Optional(Type.Unknown()),
			display: Type.Boolean(),
			modelVisible: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("thinking_level_change"),
			thinkingLevel: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("model_change"),
			provider: Type.String(),
			modelId: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("label"),
			targetId: Type.String(),
			label: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("session_info"),
			name: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...ConversationDocumentEntryBaseSchema,
			type: Type.Literal("tool_timing"),
			toolCallId: Type.String(),
			toolName: Type.String(),
			startedAt: Type.Number(),
			durationMs: Type.Number(),
			phases: Type.Array(ToolPhaseSchema),
		},
		{ additionalProperties: false },
	),
]);

export const ConversationSeedRecordSchema = Type.Object(
	{
		recordType: Type.Literal("conversation.seed"),
		schemaVersion: Type.Literal(CONVERSATION_SCHEMA_VERSION),
		entries: Type.Array(ConversationDocumentEntrySchema),
		activeLeafId: Type.Union([Type.String(), Type.Null()]),
		name: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export const ConversationContinuationSeedRecordSchema = Type.Object(
	{
		recordType: Type.Literal("conversation.continuation.seed"),
		schemaVersion: Type.Literal(CONVERSATION_SCHEMA_VERSION),
		sourceSessionId: Type.String(),
		sourceSessionPath: Type.String(),
		sourceEntryId: Type.String(),
		reason: Type.String(),
		entries: Type.Array(ConversationDocumentEntrySchema),
		activeLeafId: Type.Union([Type.String(), Type.Null()]),
	},
	{ additionalProperties: false },
);

export const ConversationImportSeedRecordSchema = Type.Object(
	{
		recordType: Type.Literal("conversation.import.seed"),
		schemaVersion: Type.Literal(CONVERSATION_SCHEMA_VERSION),
		source: Type.Object(
			{
				format: Type.Literal("coding-agent-jsonl"),
				path: Type.String(),
				sessionId: Type.String(),
				version: Type.Number(),
			},
			{ additionalProperties: false },
		),
		entries: Type.Array(ConversationDocumentEntrySchema),
		activeLeafId: Type.Union([Type.String(), Type.Null()]),
		name: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export const ConversationSnapshotSchema = Type.Object(
	{
		sessionId: Type.String(),
		version: Type.Integer({ minimum: 0 }),
		messages: Type.Array(ConversationMessageSchema),
		createdAt: Type.Number(),
	},
	{ additionalProperties: false },
);

export const ConversationSnapshotRecordSchema = Type.Object(
	{
		recordType: Type.Literal("conversation.snapshot"),
		schemaVersion: Type.Literal(CONVERSATION_SCHEMA_VERSION),
		snapshot: ConversationSnapshotSchema,
	},
	{ additionalProperties: false },
);

export type ConversationFileHeader = Static<typeof CurrentConversationFileHeaderSchema>;
export type ReadConversationFileHeader = Static<typeof ConversationFileHeaderSchema>;
export type ConversationEventRecord = Static<typeof CurrentConversationEventRecordSchema>;
export type ReadConversationEventRecord = Static<typeof ConversationEventRecordSchema>;
export type ConversationDocumentOperationRecord = Static<typeof ConversationDocumentOperationRecordSchema>;
export type ConversationSeedRecord = Static<typeof ConversationSeedRecordSchema>;
export type ConversationContinuationSeedRecord = Static<typeof ConversationContinuationSeedRecordSchema>;
export type ConversationImportSeedRecord = Static<typeof ConversationImportSeedRecordSchema>;
export type ConversationSnapshotRecord = Static<typeof ConversationSnapshotRecordSchema>;

export function isConversationFileHeader(value: unknown): value is ReadConversationFileHeader {
	return Value.Check(ConversationFileHeaderSchema, value);
}

export function isConversationEventRecord(value: unknown): value is ReadConversationEventRecord {
	return Value.Check(ConversationEventRecordSchema, value);
}

export function isConversationDocumentOperationRecord(value: unknown): value is ConversationDocumentOperationRecord {
	return Value.Check(ConversationDocumentOperationRecordSchema, value);
}

export function isConversationSeedRecord(value: unknown): value is ConversationSeedRecord {
	return Value.Check(ConversationSeedRecordSchema, value);
}

export function isConversationContinuationSeedRecord(value: unknown): value is ConversationContinuationSeedRecord {
	return Value.Check(ConversationContinuationSeedRecordSchema, value);
}

export function isConversationImportSeedRecord(value: unknown): value is ConversationImportSeedRecord {
	return Value.Check(ConversationImportSeedRecordSchema, value);
}

export function isConversationDocumentCommand(
	value: unknown,
): value is Static<typeof ConversationDocumentCommandSchema> {
	return Value.Check(ConversationDocumentCommandSchema, value);
}

export function isConversationSnapshot(value: unknown): value is Static<typeof ConversationSnapshotSchema> {
	return Value.Check(ConversationSnapshotSchema, value);
}

export function isStoredSessionEvent(value: unknown): value is Static<typeof StoredSessionEventSchema> {
	return Value.Check(StoredSessionEventSchema, value);
}
