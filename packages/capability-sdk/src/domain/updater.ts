import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

export const UPDATER_PHASES = {
	IDLE: "idle",
	CHECKING: "checking",
	AVAILABLE: "available",
	DOWNLOADING: "downloading",
	READY: "ready",
	INSTALLING: "installing",
	ERROR: "error",
} as const;

const updaterEmptyInputType = Type.Object({}, { additionalProperties: false });

const updaterPhaseType = Type.Union([
	Type.Literal(UPDATER_PHASES.IDLE),
	Type.Literal(UPDATER_PHASES.CHECKING),
	Type.Literal(UPDATER_PHASES.AVAILABLE),
	Type.Literal(UPDATER_PHASES.DOWNLOADING),
	Type.Literal(UPDATER_PHASES.READY),
	Type.Literal(UPDATER_PHASES.INSTALLING),
	Type.Literal(UPDATER_PHASES.ERROR),
]);

const updaterStateType = Type.Object(
	{
		phase: updaterPhaseType,
		currentVersion: Type.String(),
		latestVersion: Type.Optional(Type.String()),
		releaseNote: Type.Optional(Type.String()),
		progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
		downloadedBytes: Type.Optional(Type.Number({ minimum: 0 })),
		totalBytes: Type.Optional(Type.Number({ minimum: 0 })),
		assetFileName: Type.Optional(Type.String()),
		error: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export type UpdaterPhase = Static<typeof updaterPhaseType>;
export type UpdaterState = Readonly<Static<typeof updaterStateType>>;

const updaterEmptyInputSchema = defineCapabilityInputSchema(updaterEmptyInputType);
const updaterStateSchema = defineCapabilityOutputSchema(updaterStateType, { clean: true });
const updaterVersionSchema = defineCapabilityOutputSchema(Type.String());
const updaterNoOutputSchema = defineCapabilityNoOutputSchema();

export const DOMAIN_UPDATER_CAPABILITIES = {
	GET_STATE: defineCapability<Record<string, never>, UpdaterState>({
		id: "cap.domain.vetta.updater.state.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: updaterEmptyInputSchema,
		output: updaterStateSchema,
	}),
	GET_CURRENT_VERSION: defineCapability<Record<string, never>, string>({
		id: "cap.domain.vetta.updater.current-version.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: updaterEmptyInputSchema,
		output: updaterVersionSchema,
	}),
	CHECK: defineCapability<Record<string, never>, UpdaterState>({
		id: "cap.domain.vetta.updater.check",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: updaterEmptyInputSchema,
		output: updaterStateSchema,
	}),
	DOWNLOAD: defineCapability<Record<string, never>, UpdaterState>({
		id: "cap.domain.vetta.updater.download",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: updaterEmptyInputSchema,
		output: updaterStateSchema,
	}),
	INSTALL: defineCapability<Record<string, never>, undefined>({
		id: "cap.domain.vetta.updater.install",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: updaterEmptyInputSchema,
		output: updaterNoOutputSchema,
	}),
	DISMISS: defineCapability<Record<string, never>, undefined>({
		id: "cap.domain.vetta.updater.dismiss",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: updaterEmptyInputSchema,
		output: updaterNoOutputSchema,
	}),
	CANCEL: defineCapability<Record<string, never>, undefined>({
		id: "cap.domain.vetta.updater.cancel",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: updaterEmptyInputSchema,
		output: updaterNoOutputSchema,
	}),
} as const;

export const DOMAIN_UPDATER_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_UPDATER_CAPABILITIES));
