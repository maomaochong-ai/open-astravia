import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

export const SKILL_TYPES = {
	SKILL: "skill",
	SCENE: "scene",
} as const;

export const INSTALLED_SKILL_SOURCES = {
	MARKET: "market",
	CUSTOM: "custom",
} as const;

const skillEmptyInputType = Type.Object({}, { additionalProperties: false });

const skillTypeType = Type.Union([Type.Literal(SKILL_TYPES.SKILL), Type.Literal(SKILL_TYPES.SCENE)]);
export const SKILL_PRESENTATION_SURFACES = {
	ABILITY_CATALOG: "abilityCatalog",
	AGENT_CONFIGURATION: "agentConfiguration",
	COMMAND_PALETTE: "commandPalette",
	SKILL_PICKER: "skillPicker",
	PLUGIN_DETAIL: "pluginDetail",
} as const;
const skillPresentationSurfaceType = Type.Union(
	Object.values(SKILL_PRESENTATION_SURFACES).map((surface) => Type.Literal(surface)),
);
export const SkillVisibilitySchema = Type.Union([Type.Literal("visible"), Type.Literal("hidden")]);
export const SkillSurfaceVisibilitySchema = Type.Partial(
	Type.Object(
		{
			abilityCatalog: SkillVisibilitySchema,
			agentConfiguration: SkillVisibilitySchema,
			commandPalette: SkillVisibilitySchema,
			skillPicker: SkillVisibilitySchema,
			pluginDetail: SkillVisibilitySchema,
		},
		{ additionalProperties: false },
	),
);
export const SkillPresentationSchema = Type.Object(
	{
		defaultVisibility: Type.Optional(SkillVisibilitySchema),
		surfaces: Type.Optional(SkillSurfaceVisibilitySchema),
		displayName: Type.Optional(Type.String()),
		displayDescription: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);
const skillProvenanceType = Type.Union([
	Type.Object({ kind: Type.Literal("native"), scope: Type.String() }, { additionalProperties: false }),
	Type.Object(
		{
			kind: Type.Literal("provided"),
			providerType: Type.Union([Type.Literal("plugin"), Type.Literal("sdk"), Type.Literal("runtime")]),
			providerId: Type.String(),
		},
		{ additionalProperties: false },
	),
	Type.Object({ kind: Type.Literal("builtin"), providerId: Type.String() }, { additionalProperties: false }),
]);
const installedSkillSourceType = Type.Union([
	Type.Literal(INSTALLED_SKILL_SOURCES.MARKET),
	Type.Literal(INSTALLED_SKILL_SOURCES.CUSTOM),
]);
const skillNonBlankInputStringType = Type.String({ pattern: "\\S" });

const skillInfoType = Type.Object(
	{
		name: Type.String(),
		alias: Type.Optional(Type.String()),
		description: Type.String(),
		source: Type.String(),
		type: skillTypeType,
		provenance: Type.Optional(skillProvenanceType),
		presentation: Type.Optional(SkillPresentationSchema),
	},
	{ additionalProperties: false },
);

const installedSkillType = Type.Object(
	{
		name: Type.String(),
		version: Type.String(),
		installedAt: Type.String(),
		source: installedSkillSourceType,
		enabled: Type.Boolean(),
		type: Type.Optional(skillTypeType),
		alias: Type.Optional(Type.String()),
		marketDescription: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const skillListInputType = Type.Object(
	{
		cwd: Type.Optional(skillNonBlankInputStringType),
	},
	{ additionalProperties: false },
);

const skillSetEnabledInputType = Type.Object(
	{
		name: skillNonBlankInputStringType,
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const skillSetEnabledResultType = Type.Object(
	{
		name: Type.String(),
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const skillUninstallInputType = Type.Object(
	{
		name: skillNonBlankInputStringType,
		type: Type.Optional(skillTypeType),
	},
	{ additionalProperties: false },
);

export type SkillType = Static<typeof skillTypeType>;
export type SkillProvenance = Static<typeof skillProvenanceType>;
export type SkillPresentationSurface = Static<typeof skillPresentationSurfaceType>;
export type SkillVisibility = Static<typeof SkillVisibilitySchema>;
export type SkillPresentation = Readonly<Static<typeof SkillPresentationSchema>>;
export interface SkillProviderPresentation {
	readonly defaultVisibility?: SkillVisibility;
	readonly surfaces?: SkillPresentation["surfaces"];
	readonly skills?: Readonly<Record<string, SkillPresentation>>;
}
export type InstalledSkillSource = Static<typeof installedSkillSourceType>;
export type SkillInfo = Readonly<Static<typeof skillInfoType>>;
export type InstalledSkill = Readonly<Static<typeof installedSkillType>>;
export type SkillListInput = Readonly<Static<typeof skillListInputType>>;
export type SkillSetEnabledInput = Readonly<Static<typeof skillSetEnabledInputType>>;
export type SkillSetEnabledResult = Readonly<Static<typeof skillSetEnabledResultType>>;
export type SkillUninstallInput = Readonly<Static<typeof skillUninstallInputType>>;

export function isSkillVisibleOnSurface(
	skill: Pick<SkillInfo, "presentation" | "provenance" | "source">,
	surface: SkillPresentationSurface,
): boolean {
	const pluginProvided =
		skill.source === "plugin" ||
		(skill.provenance?.kind === "provided" && skill.provenance.providerType === "plugin");
	const visibility =
		skill.presentation?.surfaces?.[surface] ??
		skill.presentation?.defaultVisibility ??
		(pluginProvided ? "hidden" : "visible");
	return visibility === "visible";
}

export function getSkillDisplayName(skill: Pick<SkillInfo, "name" | "alias" | "presentation">): string {
	return skill.presentation?.displayName?.trim() || skill.alias?.trim() || skill.name;
}

export function getSkillDisplayDescription(skill: Pick<SkillInfo, "description" | "presentation">): string {
	return skill.presentation?.displayDescription?.trim() || skill.description;
}

/** Merge a provider-wide policy with one Skill override before resolving a UI surface. */
export function resolveSkillProviderPresentation(
	provider: SkillProviderPresentation | undefined,
	skillName: string,
): SkillPresentation | undefined {
	if (!provider) return undefined;
	const skill = provider.skills?.[skillName];
	return {
		defaultVisibility: skill?.defaultVisibility ?? provider.defaultVisibility,
		surfaces: { ...provider.surfaces, ...skill?.surfaces },
		...(skill?.displayName ? { displayName: skill.displayName } : {}),
		...(skill?.displayDescription ? { displayDescription: skill.displayDescription } : {}),
	};
}

const skillListInputSchema = defineCapabilityInputSchema(skillListInputType, { clean: true });
const skillListOutputSchema = defineCapabilityOutputSchema(Type.Array(skillInfoType), { clean: true });
const skillEmptyInputSchema = defineCapabilityInputSchema(skillEmptyInputType);
const installedSkillsOutputSchema = defineCapabilityOutputSchema(Type.Record(Type.String(), installedSkillType), {
	clean: true,
});
const skillSetEnabledInputSchema = defineCapabilityInputSchema(skillSetEnabledInputType, { clean: true });
const skillSetEnabledOutputSchema = defineCapabilityOutputSchema(skillSetEnabledResultType, { clean: true });
const skillUninstallInputSchema = defineCapabilityInputSchema(skillUninstallInputType, { clean: true });
const skillNoOutputSchema = defineCapabilityNoOutputSchema();

export const DOMAIN_SKILL_CAPABILITIES = {
	LIST: defineCapability<SkillListInput, SkillInfo[]>({
		id: "cap.domain.vetta.skill.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: skillListInputSchema,
		output: skillListOutputSchema,
	}),
	LIST_INSTALLED: defineCapability<Record<string, never>, Record<string, InstalledSkill>>({
		id: "cap.domain.vetta.skill.installed.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: skillEmptyInputSchema,
		output: installedSkillsOutputSchema,
	}),
	SET_ENABLED: defineCapability<SkillSetEnabledInput, SkillSetEnabledResult>({
		id: "cap.domain.vetta.skill.installed.set-enabled",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: skillSetEnabledInputSchema,
		output: skillSetEnabledOutputSchema,
	}),
	UNINSTALL: defineCapability<SkillUninstallInput, undefined>({
		id: "cap.domain.vetta.skill.installed.uninstall",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: skillUninstallInputSchema,
		output: skillNoOutputSchema,
	}),
} as const;

export const DOMAIN_SKILL_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_SKILL_CAPABILITIES));
