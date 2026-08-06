import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
	rejectCapabilitySchemaExcess,
} from "../schema.js";

export const KNOWLEDGE_NODE_TYPES = {
	FILE: "file",
	DIRECTORY: "directory",
} as const;

export const KNOWLEDGE_PROCESS_STATUSES = {
	PROCESSED: "processed",
	STALE: "stale",
	FAILED: "failed",
	UNPROCESSED: "unprocessed",
} as const;

export const KNOWLEDGE_SCAN_REASONS = {
	NO_MODEL: "no-model",
} as const;

const knowledgeEmptyInputType = Type.Object({}, { additionalProperties: false });

const knowledgeNodeTypeType = Type.Union([
	Type.Literal(KNOWLEDGE_NODE_TYPES.FILE),
	Type.Literal(KNOWLEDGE_NODE_TYPES.DIRECTORY),
]);

const knowledgeProcessStatusType = Type.Union([
	Type.Literal(KNOWLEDGE_PROCESS_STATUSES.PROCESSED),
	Type.Literal(KNOWLEDGE_PROCESS_STATUSES.STALE),
	Type.Literal(KNOWLEDGE_PROCESS_STATUSES.FAILED),
	Type.Literal(KNOWLEDGE_PROCESS_STATUSES.UNPROCESSED),
]);

const knowledgeScanReasonType = Type.Literal(KNOWLEDGE_SCAN_REASONS.NO_MODEL);
const knowledgeNonBlankInputStringType = Type.String({ pattern: "\\S" });
const knowledgeNonNegativeNumberType = Type.Number({ minimum: 0 });
const knowledgeNonNegativeIntegerType = Type.Integer({ minimum: 0 });

const knowledgeNodeType = Type.Recursive((self) =>
	Type.Object(
		{
			id: Type.String(),
			name: Type.String(),
			type: knowledgeNodeTypeType,
			children: Type.Optional(Type.Array(self)),
			childCount: Type.Optional(knowledgeNonNegativeNumberType),
			size: Type.Optional(knowledgeNonNegativeNumberType),
			sourcePath: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
);

const knowledgeBaseType = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		updatedAt: knowledgeNonNegativeNumberType,
		isDefault: Type.Boolean(),
		nodes: Type.Array(knowledgeNodeType),
	},
	{ additionalProperties: false },
);

const knowledgeFileStatusType = Type.Object(
	{
		status: knowledgeProcessStatusType,
		wikiPath: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const knowledgeFileStatusesType = Type.Record(Type.String(), knowledgeFileStatusType);

const knowledgeProcessingSettingsType = Type.Object(
	{
		enabled: Type.Optional(Type.Boolean()),
		pollIntervalMinutes: Type.Optional(knowledgeNonNegativeIntegerType),
		processingModelKey: Type.Optional(Type.String()),
		processingModelReasoningLevel: Type.Optional(Type.String()),
		agentConcurrency: Type.Optional(knowledgeNonNegativeIntegerType),
		ocrConcurrency: Type.Optional(knowledgeNonNegativeIntegerType),
	},
	{ additionalProperties: false },
);

const knowledgePollIntervalType = Type.Union([
	Type.Literal(0),
	Type.Literal(3),
	Type.Literal(5),
	Type.Literal(10),
	Type.Literal(30),
]);

const knowledgeNullableStringType = Type.Union([Type.String(), Type.Null()]);

const knowledgeProcessingUpdateType = rejectCapabilitySchemaExcess(
	Type.Object(
		{
			enabled: Type.Optional(Type.Boolean()),
			pollIntervalMinutes: Type.Optional(knowledgePollIntervalType),
			processingModelKey: Type.Optional(knowledgeNullableStringType),
			processingModelReasoningLevel: Type.Optional(knowledgeNullableStringType),
			agentConcurrency: Type.Optional(Type.Integer({ minimum: 1 })),
			ocrConcurrency: Type.Optional(Type.Integer({ minimum: 1 })),
		},
		{ additionalProperties: false, minProperties: 1 },
	),
);

const knowledgeScanResultType = Type.Object(
	{
		skipped: Type.Boolean(),
		reason: Type.Optional(knowledgeScanReasonType),
	},
	{ additionalProperties: false },
);

const knowledgeNameInputType = Type.Object(
	{
		name: knowledgeNonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const knowledgeRenameInputType = Type.Object(
	{
		name: knowledgeNonBlankInputStringType,
		newName: knowledgeNonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const knowledgeAddFilesInputType = Type.Object(
	{
		kbId: knowledgeNonBlankInputStringType,
		paths: Type.Array(knowledgeNonBlankInputStringType),
		move: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const knowledgeDeleteEntryInputType = Type.Object(
	{
		kbId: knowledgeNonBlankInputStringType,
		relPath: knowledgeNonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const knowledgeSetProcessingInputType = Type.Object(
	{
		data: knowledgeProcessingUpdateType,
	},
	{ additionalProperties: false },
);

export type KnowledgeNodeType = (typeof KNOWLEDGE_NODE_TYPES)[keyof typeof KNOWLEDGE_NODE_TYPES];
export type KnowledgeProcessStatus = (typeof KNOWLEDGE_PROCESS_STATUSES)[keyof typeof KNOWLEDGE_PROCESS_STATUSES];
export type KnowledgeScanReason = (typeof KNOWLEDGE_SCAN_REASONS)[keyof typeof KNOWLEDGE_SCAN_REASONS];
export type KnowledgeNode = Readonly<Static<typeof knowledgeNodeType>>;
export type KnowledgeBase = Readonly<Static<typeof knowledgeBaseType>>;
export type KnowledgeFileStatus = Readonly<Static<typeof knowledgeFileStatusType>>;
export type KnowledgeFileStatuses = Readonly<Static<typeof knowledgeFileStatusesType>>;
export type KnowledgeProcessingSettings = Readonly<Static<typeof knowledgeProcessingSettingsType>>;
export type KnowledgeProcessingUpdate = Readonly<Static<typeof knowledgeProcessingUpdateType>>;
export type KnowledgeScanResult = Readonly<Static<typeof knowledgeScanResultType>>;
export type KnowledgeNameInput = Readonly<Static<typeof knowledgeNameInputType>>;
export type KnowledgeRenameInput = Readonly<Static<typeof knowledgeRenameInputType>>;
export type KnowledgeAddFilesInput = Readonly<Static<typeof knowledgeAddFilesInputType>>;
export type KnowledgeDeleteEntryInput = Readonly<Static<typeof knowledgeDeleteEntryInputType>>;
export type KnowledgeSetProcessingInput = Readonly<Static<typeof knowledgeSetProcessingInputType>>;

const knowledgeEmptyInputSchema = defineCapabilityInputSchema(knowledgeEmptyInputType);
const knowledgeBasesOutputSchema = defineCapabilityOutputSchema(Type.Array(knowledgeBaseType), { clean: true });
const knowledgeFileStatusesOutputSchema = defineCapabilityOutputSchema(knowledgeFileStatusesType, { clean: true });
const knowledgeProcessingStatusOutputSchema = defineCapabilityOutputSchema(Type.Boolean());
const knowledgeProcessingSettingsOutputSchema = defineCapabilityOutputSchema(knowledgeProcessingSettingsType, {
	clean: true,
});
const knowledgeNameInputSchema = defineCapabilityInputSchema(knowledgeNameInputType, { clean: true });
const knowledgeNoOutputSchema = defineCapabilityNoOutputSchema();
const knowledgeRenameInputSchema = defineCapabilityInputSchema(knowledgeRenameInputType, { clean: true });
const knowledgeAddFilesInputSchema = defineCapabilityInputSchema(knowledgeAddFilesInputType, { clean: true });
const knowledgeDeleteEntryInputSchema = defineCapabilityInputSchema(knowledgeDeleteEntryInputType, { clean: true });
const knowledgeScanResultOutputSchema = defineCapabilityOutputSchema(knowledgeScanResultType, { clean: true });
const knowledgeSetProcessingInputSchema = defineCapabilityInputSchema(knowledgeSetProcessingInputType, {
	clean: true,
});

export const DOMAIN_KNOWLEDGE_CAPABILITIES = {
	LIST_BASES: defineCapability<Record<string, never>, KnowledgeBase[]>({
		id: "cap.domain.vetta.knowledge.base.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeEmptyInputSchema,
		output: knowledgeBasesOutputSchema,
	}),
	LIST_FILE_STATUSES: defineCapability<Record<string, never>, KnowledgeFileStatuses>({
		id: "cap.domain.vetta.knowledge.file-status.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeEmptyInputSchema,
		output: knowledgeFileStatusesOutputSchema,
	}),
	GET_PROCESSING_STATUS: defineCapability<Record<string, never>, boolean>({
		id: "cap.domain.vetta.knowledge.processing.status.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeEmptyInputSchema,
		output: knowledgeProcessingStatusOutputSchema,
	}),
	GET_PROCESSING_SETTINGS: defineCapability<Record<string, never>, KnowledgeProcessingSettings>({
		id: "cap.domain.vetta.knowledge.processing.settings.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeEmptyInputSchema,
		output: knowledgeProcessingSettingsOutputSchema,
	}),
	CREATE_BASE: defineCapability<KnowledgeNameInput, undefined>({
		id: "cap.domain.vetta.knowledge.base.create",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeNameInputSchema,
		output: knowledgeNoOutputSchema,
	}),
	RENAME_BASE: defineCapability<KnowledgeRenameInput, undefined>({
		id: "cap.domain.vetta.knowledge.base.rename",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeRenameInputSchema,
		output: knowledgeNoOutputSchema,
	}),
	DELETE_BASE: defineCapability<KnowledgeNameInput, undefined>({
		id: "cap.domain.vetta.knowledge.base.delete",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeNameInputSchema,
		output: knowledgeNoOutputSchema,
	}),
	ADD_FILES: defineCapability<KnowledgeAddFilesInput, undefined>({
		id: "cap.domain.vetta.knowledge.entry.add-files",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeAddFilesInputSchema,
		output: knowledgeNoOutputSchema,
	}),
	DELETE_ENTRY: defineCapability<KnowledgeDeleteEntryInput, undefined>({
		id: "cap.domain.vetta.knowledge.entry.delete",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeDeleteEntryInputSchema,
		output: knowledgeNoOutputSchema,
	}),
	SCAN_NOW: defineCapability<Record<string, never>, KnowledgeScanResult>({
		id: "cap.domain.vetta.knowledge.processing.scan",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeEmptyInputSchema,
		output: knowledgeScanResultOutputSchema,
	}),
	RETRY_FAILED: defineCapability<Record<string, never>, KnowledgeScanResult>({
		id: "cap.domain.vetta.knowledge.processing.retry-failed",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeEmptyInputSchema,
		output: knowledgeScanResultOutputSchema,
	}),
	SET_PROCESSING_SETTINGS: defineCapability<KnowledgeSetProcessingInput, KnowledgeProcessingSettings>({
		id: "cap.domain.vetta.knowledge.processing.settings.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: knowledgeSetProcessingInputSchema,
		output: knowledgeProcessingSettingsOutputSchema,
	}),
} as const;

export const DOMAIN_KNOWLEDGE_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(DOMAIN_KNOWLEDGE_CAPABILITIES),
);
