import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

const projectEmptyInputType = Type.Object({}, { additionalProperties: false });

const projectNonBlankInputStringType = Type.String({ pattern: "\\S" });

const projectEntryType = Type.Object(
	{
		path: Type.String(),
		name: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export type ProjectEntry = Readonly<Static<typeof projectEntryType>>;

const projectEntriesType = Type.Array(projectEntryType);

const projectListResultType = Type.Object(
	{
		workspacePath: Type.String(),
		projects: projectEntriesType,
		archivedProjects: projectEntriesType,
	},
	{ additionalProperties: false },
);

const projectCreateInputType = Type.Object(
	{
		name: projectNonBlankInputStringType,
		path: Type.Optional(projectNonBlankInputStringType),
	},
	{ additionalProperties: false },
);

const projectOpenInputType = Type.Object(
	{
		path: projectNonBlankInputStringType,
		name: Type.Optional(projectNonBlankInputStringType),
	},
	{ additionalProperties: false },
);

const projectRenameInputType = Type.Object(
	{
		path: projectNonBlankInputStringType,
		name: projectNonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const projectPathInputType = Type.Object(
	{
		path: projectNonBlankInputStringType,
	},
	{ additionalProperties: false },
);

type ProjectListResultValue = Static<typeof projectListResultType>;
export type ProjectListResult = Readonly<
	Omit<ProjectListResultValue, "projects" | "archivedProjects"> & {
		readonly projects: readonly ProjectEntry[];
		readonly archivedProjects: readonly ProjectEntry[];
	}
>;
export type ProjectCreateInput = Readonly<Static<typeof projectCreateInputType>>;
export type ProjectOpenInput = Readonly<Static<typeof projectOpenInputType>>;
export type ProjectRenameInput = Readonly<Static<typeof projectRenameInputType>>;
export type ProjectPathInput = Readonly<Static<typeof projectPathInputType>>;

const projectEmptyInputSchema = defineCapabilityInputSchema(projectEmptyInputType);
const projectEntryOutputSchema = defineCapabilityOutputSchema(projectEntryType, { clean: true });
const projectListOutputSchema = defineCapabilityOutputSchema(projectListResultType, { clean: true });
const projectCreateInputSchema = defineCapabilityInputSchema(projectCreateInputType, { clean: true });
const projectOpenInputSchema = defineCapabilityInputSchema(projectOpenInputType, { clean: true });
const projectRenameInputSchema = defineCapabilityInputSchema(projectRenameInputType, { clean: true });
const projectPathInputSchema = defineCapabilityInputSchema(projectPathInputType, { clean: true });
const projectNoOutputSchema = defineCapabilityNoOutputSchema();

export const DOMAIN_PROJECT_CAPABILITIES = {
	LIST: defineCapability<Record<string, never>, ProjectListResult>({
		id: "cap.domain.vetta.project.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: projectEmptyInputSchema,
		output: projectListOutputSchema,
	}),
	CREATE: defineCapability<ProjectCreateInput, ProjectEntry>({
		id: "cap.domain.vetta.project.create",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: projectCreateInputSchema,
		output: projectEntryOutputSchema,
	}),
	OPEN: defineCapability<ProjectOpenInput, ProjectEntry>({
		id: "cap.domain.vetta.project.open",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: projectOpenInputSchema,
		output: projectEntryOutputSchema,
	}),
	RENAME: defineCapability<ProjectRenameInput, ProjectEntry>({
		id: "cap.domain.vetta.project.rename",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: projectRenameInputSchema,
		output: projectEntryOutputSchema,
	}),
	ARCHIVE: defineCapability<ProjectPathInput, undefined>({
		id: "cap.domain.vetta.project.archive",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: projectPathInputSchema,
		output: projectNoOutputSchema,
	}),
	UNARCHIVE: defineCapability<ProjectPathInput, undefined>({
		id: "cap.domain.vetta.project.unarchive",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: projectPathInputSchema,
		output: projectNoOutputSchema,
	}),
	REMOVE: defineCapability<ProjectPathInput, undefined>({
		id: "cap.domain.vetta.project.remove",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: projectPathInputSchema,
		output: projectNoOutputSchema,
	}),
} as const;

export const DOMAIN_PROJECT_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_PROJECT_CAPABILITIES));
