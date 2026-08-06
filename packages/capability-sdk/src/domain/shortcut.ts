import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

export const QUICK_PANEL_TRIGGERS = {
	NONE: "none",
	MOD: "mod",
	ALT: "alt",
	SHIFT: "shift",
} as const;

export const QUICK_PANEL_POST_SEND_BEHAVIORS = {
	FOREGROUND: "foreground",
	BACKGROUND: "background",
} as const;

const shortcutEmptyInputType = Type.Object({}, { additionalProperties: false });

const quickPanelTriggerType = Type.Union([
	Type.Literal(QUICK_PANEL_TRIGGERS.NONE),
	Type.Literal(QUICK_PANEL_TRIGGERS.MOD),
	Type.Literal(QUICK_PANEL_TRIGGERS.ALT),
	Type.Literal(QUICK_PANEL_TRIGGERS.SHIFT),
]);

const quickPanelPostSendBehaviorType = Type.Union([
	Type.Literal(QUICK_PANEL_POST_SEND_BEHAVIORS.FOREGROUND),
	Type.Literal(QUICK_PANEL_POST_SEND_BEHAVIORS.BACKGROUND),
]);

const shortcutBindingType = Type.Object(
	{
		id: Type.String(),
		defaultShortcut: Type.String(),
		shortcut: Type.String(),
		isDefault: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const quickPanelSettingsType = Type.Object(
	{
		trigger: quickPanelTriggerType,
		postSendBehavior: quickPanelPostSendBehaviorType,
	},
	{ additionalProperties: false },
);

const shortcutSettingsType = Type.Object(
	{
		bindings: Type.Array(shortcutBindingType),
		quickPanel: quickPanelSettingsType,
	},
	{ additionalProperties: false },
);

const shortcutBindingInputType = Type.Object(
	{
		id: Type.String({ pattern: "\\S" }),
		shortcut: Type.String(),
	},
	{ additionalProperties: false },
);

const shortcutActionInputType = Type.Object(
	{
		id: Type.String({ pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

const shortcutBindingsResultType = Type.Object(
	{
		bindings: Type.Array(shortcutBindingType),
	},
	{ additionalProperties: false },
);

const shortcutBindingResetResultType = Type.Object(
	{
		bindings: Type.Array(shortcutBindingType),
		shortcut: Type.String(),
	},
	{ additionalProperties: false },
);

const quickPanelTriggerInputType = Type.Object(
	{
		trigger: quickPanelTriggerType,
	},
	{ additionalProperties: false },
);

const quickPanelPostSendBehaviorInputType = Type.Object(
	{
		behavior: quickPanelPostSendBehaviorType,
	},
	{ additionalProperties: false },
);

export type QuickPanelTrigger = Static<typeof quickPanelTriggerType>;
export type QuickPanelPostSendBehavior = Static<typeof quickPanelPostSendBehaviorType>;
export type ShortcutBinding = Readonly<Static<typeof shortcutBindingType>>;
export type QuickPanelSettings = Readonly<Static<typeof quickPanelSettingsType>>;
export type ShortcutSettings = Readonly<Static<typeof shortcutSettingsType>>;
export type ShortcutBindingInput = Readonly<Static<typeof shortcutBindingInputType>>;
export type ShortcutActionInput = Readonly<Static<typeof shortcutActionInputType>>;
export type ShortcutBindingsResult = Readonly<Static<typeof shortcutBindingsResultType>>;
export type ShortcutBindingResetResult = Readonly<Static<typeof shortcutBindingResetResultType>>;
export type QuickPanelTriggerInput = Readonly<Static<typeof quickPanelTriggerInputType>>;
export type QuickPanelPostSendBehaviorInput = Readonly<Static<typeof quickPanelPostSendBehaviorInputType>>;

const shortcutEmptyInputSchema = defineCapabilityInputSchema(shortcutEmptyInputType);
const shortcutSettingsOutputSchema = defineCapabilityOutputSchema(shortcutSettingsType, { clean: true });
const shortcutBindingInputSchema = defineCapabilityInputSchema(shortcutBindingInputType, { clean: true });
const shortcutBindingsOutputSchema = defineCapabilityOutputSchema(shortcutBindingsResultType, { clean: true });
const shortcutActionInputSchema = defineCapabilityInputSchema(shortcutActionInputType, { clean: true });
const shortcutBindingResetOutputSchema = defineCapabilityOutputSchema(shortcutBindingResetResultType, { clean: true });
const quickPanelTriggerInputSchema = defineCapabilityInputSchema(quickPanelTriggerInputType, { clean: true });
const quickPanelPostSendBehaviorInputSchema = defineCapabilityInputSchema(quickPanelPostSendBehaviorInputType, {
	clean: true,
});
const quickPanelSettingsOutputSchema = defineCapabilityOutputSchema(quickPanelSettingsType, { clean: true });

export const DOMAIN_SHORTCUT_CAPABILITIES = {
	GET_SETTINGS: defineCapability<Record<string, never>, ShortcutSettings>({
		id: "cap.domain.vetta.shortcut.settings.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: shortcutEmptyInputSchema,
		output: shortcutSettingsOutputSchema,
	}),
	SET_BINDING: defineCapability<ShortcutBindingInput, ShortcutBindingsResult>({
		id: "cap.domain.vetta.shortcut.binding.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: shortcutBindingInputSchema,
		output: shortcutBindingsOutputSchema,
	}),
	RESET_BINDING: defineCapability<ShortcutActionInput, ShortcutBindingResetResult>({
		id: "cap.domain.vetta.shortcut.binding.reset",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: shortcutActionInputSchema,
		output: shortcutBindingResetOutputSchema,
	}),
	RESET_ALL_BINDINGS: defineCapability<Record<string, never>, ShortcutBindingsResult>({
		id: "cap.domain.vetta.shortcut.binding.reset-all",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: shortcutEmptyInputSchema,
		output: shortcutBindingsOutputSchema,
	}),
} as const;

export const DOMAIN_SHORTCUT_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_SHORTCUT_CAPABILITIES));

export const DOMAIN_QUICK_PANEL_CAPABILITIES = {
	SET_TRIGGER: defineCapability<QuickPanelTriggerInput, QuickPanelSettings>({
		id: "cap.domain.vetta.quick-panel.trigger.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: quickPanelTriggerInputSchema,
		output: quickPanelSettingsOutputSchema,
	}),
	SET_POST_SEND_BEHAVIOR: defineCapability<QuickPanelPostSendBehaviorInput, QuickPanelSettings>({
		id: "cap.domain.vetta.quick-panel.post-send-behavior.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: quickPanelPostSendBehaviorInputSchema,
		output: quickPanelSettingsOutputSchema,
	}),
} as const;

export const DOMAIN_QUICK_PANEL_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(DOMAIN_QUICK_PANEL_CAPABILITIES),
);
