import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

export const DOWNLOAD_STATUSES = {
	QUEUED: "queued",
	DOWNLOADING: "downloading",
	PAUSED: "paused",
	COMPLETED: "completed",
	FAILED: "failed",
	CANCELED: "canceled",
} as const;

const downloadListInputType = Type.Object({}, { additionalProperties: false });

const downloadStatusType = Type.Union([
	Type.Literal(DOWNLOAD_STATUSES.QUEUED),
	Type.Literal(DOWNLOAD_STATUSES.DOWNLOADING),
	Type.Literal(DOWNLOAD_STATUSES.PAUSED),
	Type.Literal(DOWNLOAD_STATUSES.COMPLETED),
	Type.Literal(DOWNLOAD_STATUSES.FAILED),
	Type.Literal(DOWNLOAD_STATUSES.CANCELED),
]);

const downloadItemType = Type.Object({
	id: Type.String(),
	url: Type.String(),
	filename: Type.String(),
	path: Type.String(),
	totalBytes: Type.Number(),
	receivedBytes: Type.Number(),
	status: downloadStatusType,
	error: Type.Optional(Type.String()),
	createdAt: Type.Number(),
	completedAt: Type.Optional(Type.Number()),
	speedBytesPerSec: Type.Optional(Type.Number()),
});

const downloadCancelInputType = Type.Object({
	id: Type.String({ pattern: "\\S" }),
});

export type DownloadStatus = Static<typeof downloadStatusType>;
export type DownloadItem = Readonly<Static<typeof downloadItemType>>;
export type DownloadCancelInput = Readonly<Static<typeof downloadCancelInputType>>;

const downloadListInputSchema = defineCapabilityInputSchema(downloadListInputType);
const downloadListOutputSchema = defineCapabilityOutputSchema(Type.Array(downloadItemType), { clean: true });
const downloadCancelInputSchema = defineCapabilityInputSchema(downloadCancelInputType, { clean: true });
const downloadCancelOutputSchema = defineCapabilityNoOutputSchema();

export const DOMAIN_DOWNLOAD_CAPABILITIES = {
	LIST: defineCapability<Record<string, never>, DownloadItem[]>({
		id: "cap.domain.vetta.download.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: downloadListInputSchema,
		output: downloadListOutputSchema,
	}),
	CANCEL: defineCapability<DownloadCancelInput, undefined>({
		id: "cap.domain.vetta.download.cancel",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: downloadCancelInputSchema,
		output: downloadCancelOutputSchema,
	}),
} as const;

export const DOMAIN_DOWNLOAD_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_DOWNLOAD_CAPABILITIES));
