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
export type InstalledSkillSource = Static<typeof installedSkillSourceType>;
export type SkillInfo = Readonly<Static<typeof skillInfoType>>;
export type InstalledSkill = Readonly<Static<typeof installedSkillType>>;
export type SkillListInput = Readonly<Static<typeof skillListInputType>>;
export type SkillSetEnabledInput = Readonly<Static<typeof skillSetEnabledInputType>>;
export type SkillSetEnabledResult = Readonly<Static<typeof skillSetEnabledResultType>>;
export type SkillUninstallInput = Readonly<Static<typeof skillUninstallInputType>>;

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
