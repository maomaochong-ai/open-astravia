import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

export const GENERAL_EXECUTION_MODES = {
	SANDBOX: "sandbox",
	FULL_ACCESS: "full-access",
} as const;

export const SANDBOX_STATUSES = {
	UNKNOWN: "unknown",
	AVAILABLE: "available",
	UNAVAILABLE: "unavailable",
} as const;

export const SANDBOX_BACKENDS = {
	BUNDLED_BWRAP: "bundled-bwrap",
	SYSTEM_BWRAP: "system-bwrap",
	MACOS_SEATBELT: "macos-seatbelt",
	WINDOWS_HOST: "windows-host",
} as const;

const generalSettingsEmptyInputType = Type.Object({}, { additionalProperties: false });

const generalExecutionModeType = Type.Union([
	Type.Literal(GENERAL_EXECUTION_MODES.SANDBOX),
	Type.Literal(GENERAL_EXECUTION_MODES.FULL_ACCESS),
]);

const sandboxStatusType = Type.Union([
	Type.Literal(SANDBOX_STATUSES.UNKNOWN),
	Type.Literal(SANDBOX_STATUSES.AVAILABLE),
	Type.Literal(SANDBOX_STATUSES.UNAVAILABLE),
]);

const sandboxBackendType = Type.Union([
	Type.Literal(SANDBOX_BACKENDS.BUNDLED_BWRAP),
	Type.Literal(SANDBOX_BACKENDS.SYSTEM_BWRAP),
	Type.Literal(SANDBOX_BACKENDS.MACOS_SEATBELT),
	Type.Literal(SANDBOX_BACKENDS.WINDOWS_HOST),
	Type.Null(),
]);

const sandboxFeaturesType = Type.Object(
	{
		readRoots: Type.Boolean(),
		writeRoots: Type.Boolean(),
		denyRead: Type.Boolean(),
		denyWrite: Type.Boolean(),
		tempRootIsolation: Type.Boolean(),
		networkIsolation: Type.Boolean(),
		processTreeKill: Type.Boolean(),
		passiveProbe: Type.Boolean(),
		activeProbe: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const sandboxCapabilitySnapshotType = Type.Object(
	{
		status: sandboxStatusType,
		backend: sandboxBackendType,
		platform: Type.String(),
		binaryPath: Type.Optional(Type.String()),
		reason: Type.Optional(Type.String()),
		details: Type.Optional(Type.String()),
		checkedAt: Type.Optional(Type.Number()),
		features: Type.Optional(sandboxFeaturesType),
	},
	{ additionalProperties: false },
);

const generalSettingsSnapshotType = Type.Object(
	{
		workspacePath: Type.String(),
		defaultExecutionMode: generalExecutionModeType,
		notificationsEnabled: Type.Boolean(),
		debugMode: Type.Boolean(),
		sandbox: sandboxCapabilitySnapshotType,
	},
	{ additionalProperties: false },
);

const notificationsSettingType = Type.Object(
	{
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const defaultExecutionModeSettingType = Type.Object(
	{
		mode: generalExecutionModeType,
	},
	{ additionalProperties: false },
);

const workspaceSettingInputType = Type.Object(
	{
		path: Type.String({ pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

const workspaceSettingOutputType = Type.Object(
	{
		path: Type.String(),
	},
	{ additionalProperties: false },
);

export type GeneralExecutionMode = Static<typeof generalExecutionModeType>;
export type SandboxStatus = Static<typeof sandboxStatusType>;
export type SandboxBackend = Static<typeof sandboxBackendType>;
export type SandboxFeatures = Readonly<Static<typeof sandboxFeaturesType>>;
export type SandboxCapabilitySnapshot = Readonly<Static<typeof sandboxCapabilitySnapshotType>>;
export type GeneralSettingsSnapshot = Readonly<Static<typeof generalSettingsSnapshotType>>;
export type NotificationsSettingInput = Readonly<Static<typeof notificationsSettingType>>;
export type DefaultExecutionModeSettingInput = Readonly<Static<typeof defaultExecutionModeSettingType>>;
export type WorkspaceSettingInput = Readonly<Static<typeof workspaceSettingInputType>>;

const generalSettingsEmptyInputSchema = defineCapabilityInputSchema(generalSettingsEmptyInputType);
const generalSettingsSnapshotSchema = defineCapabilityOutputSchema(generalSettingsSnapshotType, { clean: true });
const notificationsSettingInputSchema = defineCapabilityInputSchema(notificationsSettingType, { clean: true });
const notificationsSettingOutputSchema = defineCapabilityOutputSchema(notificationsSettingType, { clean: true });
const defaultExecutionModeInputSchema = defineCapabilityInputSchema(defaultExecutionModeSettingType, { clean: true });
const defaultExecutionModeOutputSchema = defineCapabilityOutputSchema(defaultExecutionModeSettingType, { clean: true });
const workspaceSettingInputSchema = defineCapabilityInputSchema(workspaceSettingInputType, { clean: true });
const workspaceSettingOutputSchema = defineCapabilityOutputSchema(workspaceSettingOutputType, { clean: true });

export const DOMAIN_GENERAL_SETTINGS_CAPABILITIES = {
	GET: defineCapability<Record<string, never>, GeneralSettingsSnapshot>({
		id: "cap.domain.vetta.general-settings.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: generalSettingsEmptyInputSchema,
		output: generalSettingsSnapshotSchema,
	}),
	SET_NOTIFICATIONS: defineCapability<NotificationsSettingInput, NotificationsSettingInput>({
		id: "cap.domain.vetta.general-settings.notifications.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: notificationsSettingInputSchema,
		output: notificationsSettingOutputSchema,
	}),
	SET_DEFAULT_EXECUTION_MODE: defineCapability<DefaultExecutionModeSettingInput, DefaultExecutionModeSettingInput>({
		id: "cap.domain.vetta.general-settings.default-execution-mode.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: defaultExecutionModeInputSchema,
		output: defaultExecutionModeOutputSchema,
	}),
	SET_WORKSPACE: defineCapability<WorkspaceSettingInput, WorkspaceSettingInput>({
		id: "cap.domain.vetta.general-settings.workspace.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: workspaceSettingInputSchema,
		output: workspaceSettingOutputSchema,
	}),
} as const;

export const DOMAIN_GENERAL_SETTINGS_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(DOMAIN_GENERAL_SETTINGS_CAPABILITIES),
);
