import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

const sessionEmptyInputType = Type.Object({}, { additionalProperties: false });

const sessionListInputType = Type.Object(
	{
		cwd: Type.String({ pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

const sessionRuntimeProjectType = Type.Object(
	{
		cwd: Type.String(),
		sessionCount: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

const sessionHistoryEntryType = Type.Object(
	{
		id: Type.String(),
		path: Type.String(),
		cwd: Type.String(),
		name: Type.Optional(Type.String()),
		firstMessage: Type.String(),
		modifiedAt: Type.Number(),
		lastMessagePreview: Type.Optional(Type.String()),
		parentSessionPath: Type.Optional(Type.String()),
		parentEntryId: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export type SessionListInput = Readonly<Static<typeof sessionListInputType>>;
export type SessionRuntimeProject = Readonly<Static<typeof sessionRuntimeProjectType>>;
export type SessionHistoryEntry = Readonly<Static<typeof sessionHistoryEntryType>>;

const sessionEmptyInputSchema = defineCapabilityInputSchema(sessionEmptyInputType);
const sessionListInputSchema = defineCapabilityInputSchema(sessionListInputType, { clean: true });
const sessionRuntimeProjectsOutputSchema = defineCapabilityOutputSchema(Type.Array(sessionRuntimeProjectType), {
	clean: true,
});
const sessionHistoryOutputSchema = defineCapabilityOutputSchema(Type.Array(sessionHistoryEntryType), { clean: true });

export const DOMAIN_SESSION_CAPABILITIES = {
	LIST: defineCapability<SessionListInput, SessionHistoryEntry[]>({
		id: "cap.domain.vetta.session.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: sessionListInputSchema,
		output: sessionHistoryOutputSchema,
	}),
	LIST_RUNTIME_PROJECTS: defineCapability<Record<string, never>, SessionRuntimeProject[]>({
		id: "cap.domain.vetta.session.runtime-project.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: sessionEmptyInputSchema,
		output: sessionRuntimeProjectsOutputSchema,
	}),
} as const;

export const DOMAIN_SESSION_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_SESSION_CAPABILITIES));
