import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { findAgentBlueprint } from "./blueprints.js";
import type {
	AgentTeamDocument,
	CreateAgentProfileInput,
	CreateTeamInput,
	DeleteAgentProfileInput,
	DeleteTeamInput,
	SendTeamMessageInput,
	TeamSessionDocument,
	UpdateAgentProfileInput,
	UpdateTeamInput,
	UpdateTeamSessionModelSettingsInput,
} from "./contracts.js";
import { AGENT_TEAM_SCHEMA_VERSION } from "./contracts.js";
import { assertTeamInvariants, normalizeMentionHandle } from "./domain.js";
import { type AgentTeamExtensionRegistry, DEFAULT_AGENT_TEAM_EXTENSIONS, requireTeamPolicies } from "./extensions.js";

const id = Type.String({ minLength: 1, maxLength: 256, pattern: "^\\S(?:[^\\r\\n]*\\S)?$" });
const text = Type.String({ maxLength: 64_000 });
const timestamp = Type.Number({ minimum: 0 });
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const stringList = Type.Array(id, { maxItems: 512, uniqueItems: true });
const promptAttachment = Type.Object(
	{
		kind: Type.Union([Type.Literal("file"), Type.Literal("directory"), Type.Literal("image")]),
		path: Type.String({ minLength: 1, maxLength: 4_096 }),
	},
	{ additionalProperties: false },
);
const abilities = Type.Object(
	{
		selectionMode: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("custom")])),
		skills: stringList,
		mcpServers: stringList,
		plugins: stringList,
		extensions: Type.Optional(Type.Record(id, stringList)),
	},
	{ additionalProperties: false },
);
const optionalAbilities = Type.Partial(abilities, { additionalProperties: false });
const profile = Type.Object(
	{
		id,
		revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		name: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
		description: text,
		avatar: Type.Optional(Type.String({ maxLength: 2_048 })),
		mentionHandle: id,
		blueprintId: id,
		systemPrompt: Type.Optional(text),
		presetId: Type.Optional(id),
		abilities,
		scope: Type.Union([
			Type.Object({ kind: Type.Literal("library") }, { additionalProperties: false }),
			Type.Object({ kind: Type.Literal("team"), teamId: id }, { additionalProperties: false }),
		]),
		copiedFrom: Type.Optional(id),
		createdAt: timestamp,
		updatedAt: timestamp,
	},
	{ additionalProperties: false },
);
const binding = Type.Union([
	Type.Object({ kind: Type.Literal("reference"), agentProfileId: id }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("copy"), agentProfileId: id }, { additionalProperties: false }),
]);
const member = Type.Object({ id, handle: id, binding }, { additionalProperties: false });
export const CreateAgentProfileInputSchema = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
		description: Type.Optional(text),
		avatar: Type.Optional(Type.String({ maxLength: 2_048 })),
		mentionHandle: id,
		blueprintId: id,
		abilities: Type.Optional(optionalAbilities),
	},
	{ additionalProperties: false },
);
export const UpdateAgentProfileInputSchema = Type.Object(
	{
		expectedRevision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		name: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
		description: text,
		avatar: Type.Optional(Type.String({ maxLength: 2_048 })),
		mentionHandle: id,
		systemPrompt: Type.Optional(text),
		abilities,
	},
	{ additionalProperties: false },
);
export const DeleteAgentProfileInputSchema = Type.Object(
	{
		expectedRevision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		expectedTeamIds: Type.Optional(Type.Array(id, { maxItems: 1_024, uniqueItems: true })),
		expectedTeamRevisions: Type.Optional(
			Type.Record(id, Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
		),
	},
	{ additionalProperties: false },
);
const createTeamMember = Type.Object(
	{
		agentProfileId: id,
		handle: id,
		bindingKind: Type.Union([Type.Literal("reference"), Type.Literal("copy")]),
		leader: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export const CreateTeamInputSchema = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
		description: Type.Optional(text),
		members: Type.Array(createTeamMember, { minItems: 1, maxItems: 32 }),
		orchestrationPolicyId: Type.Optional(id),
		contextPolicyId: Type.Optional(id),
	},
	{ additionalProperties: false },
);
const updateTeamMember = Type.Union([
	Type.Object(
		{ kind: Type.Literal("existing"), memberId: id, leader: Type.Boolean() },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("new"),
			agentProfileId: id,
			bindingKind: Type.Union([Type.Literal("reference"), Type.Literal("copy")]),
			leader: Type.Boolean(),
		},
		{ additionalProperties: false },
	),
]);
export const UpdateTeamInputSchema = Type.Object(
	{
		expectedRevision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		name: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
		description: text,
		members: Type.Array(updateTeamMember, { minItems: 1, maxItems: 32 }),
	},
	{ additionalProperties: false },
);
export const DeleteTeamInputSchema = Type.Object(
	{ expectedRevision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) },
	{ additionalProperties: false },
);
export const SendTeamMessageInputSchema = Type.Object(
	{
		requestId: id,
		text,
		targetMemberIds: Type.Array(id, { maxItems: 32, uniqueItems: true }),
		attachments: Type.Optional(Type.Array(promptAttachment, { maxItems: 128 })),
		modelKey: Type.Optional(id),
		reasoning: Type.Optional(id),
	},
	{ additionalProperties: false },
);
export const UpdateTeamSessionModelSettingsInputSchema = Type.Object(
	{
		modelKey: id,
		reasoning: Type.Optional(id),
	},
	{ additionalProperties: false },
);
const team = Type.Object(
	{
		id,
		revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		name: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
		description: text,
		leaderMemberId: id,
		members: Type.Array(member, { minItems: 1, maxItems: 32 }),
		orchestrationPolicyId: id,
		contextPolicyId: id,
		createdAt: timestamp,
		updatedAt: timestamp,
	},
	{ additionalProperties: false },
);
export const AgentTeamDocumentSchema = Type.Object(
	{
		schemaVersion: Type.Literal(AGENT_TEAM_SCHEMA_VERSION),
		presetVersion: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
		revision,
		agents: Type.Array(profile, { maxItems: 1_024 }),
		teams: Type.Array(team, { maxItems: 1_024 }),
	},
	{ additionalProperties: false },
);
const userEvent = Type.Object(
	{
		type: Type.Literal("user-message"),
		id,
		requestId: id,
		text,
		targetMemberIds: stringList,
		attachments: Type.Optional(Type.Array(promptAttachment, { maxItems: 128 })),
		timestamp,
	},
	{ additionalProperties: false },
);
const resultEvent = Type.Object(
	{ type: Type.Literal("member-result"), id, requestId: id, memberId: id, sourceTurnId: id, text, timestamp },
	{ additionalProperties: false },
);
const delegationEvent = Type.Object(
	{
		type: Type.Literal("member-delegation"),
		id,
		requestId: id,
		sourceMemberId: id,
		targetMemberId: id,
		objective: text,
		timestamp,
	},
	{ additionalProperties: false },
);
const memberRuntime = Type.Object(
	{
		sessionId: id,
		sessionPath: Type.String({ minLength: 1, maxLength: 4_096 }),
		agentProfileId: Type.Optional(id),
		agentProfileRevision: Type.Integer({ minimum: 1 }),
		deliveredEventIds: stringList,
		sharedCheckpointId: Type.Optional(id),
	},
	{ additionalProperties: false },
);
const coordinationRuntime = Type.Object(
	{
		sessionId: id,
		sessionPath: Type.String({ minLength: 1, maxLength: 4_096 }),
	},
	{ additionalProperties: false },
);
export const TeamSessionDocumentSchema = Type.Object(
	{
		schemaVersion: Type.Literal(AGENT_TEAM_SCHEMA_VERSION),
		revision,
		id,
		teamId: id,
		workspaceId: Type.Optional(id),
		executionMode: Type.Optional(Type.Union([Type.Literal("sandbox"), Type.Literal("full-access")])),
		modelSettings: Type.Optional(UpdateTeamSessionModelSettingsInputSchema),
		teamRevision: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
		name: Type.String({ minLength: 1, maxLength: 128, pattern: "\\S" }),
		cwd: Type.String({ minLength: 1, maxLength: 4_096 }),
		orchestrationPolicyId: Type.Optional(id),
		contextPolicyId: Type.Optional(id),
		leaderMemberId: id,
		activeMemberIds: Type.Optional(Type.Array(id, { minItems: 1, maxItems: 32, uniqueItems: true })),
		memberHandles: Type.Record(id, id),
		createdAt: timestamp,
		updatedAt: timestamp,
		coordinationRuntime: Type.Optional(coordinationRuntime),
		runtimeStatus: Type.Optional(
			Type.Union([Type.Literal("preparing"), Type.Literal("ready"), Type.Literal("failed")]),
		),
		events: Type.Array(Type.Union([userEvent, resultEvent, delegationEvent]), { maxItems: 100_000 }),
		memberRuntime: Type.Record(id, memberRuntime),
	},
	{ additionalProperties: false },
);
type ParsedAgentTeamDocument = Static<typeof AgentTeamDocumentSchema>;
type ParsedTeamSessionDocument = Static<typeof TeamSessionDocumentSchema>;
export function createEmptyAgentTeamDocument(): AgentTeamDocument {
	return { schemaVersion: AGENT_TEAM_SCHEMA_VERSION, revision: 0, agents: [], teams: [] };
}
export function parseAgentTeamDocument(
	value: unknown,
	registry: AgentTeamExtensionRegistry = DEFAULT_AGENT_TEAM_EXTENSIONS,
): AgentTeamDocument {
	if (!Value.Check(AgentTeamDocumentSchema, value)) throw new Error("Invalid Agent Team configuration document");
	const document: ParsedAgentTeamDocument = value;
	const ids = new Set<string>();
	const libraryHandles = new Set<string>();
	for (const agent of document.agents) {
		if (ids.has(agent.id)) throw new Error(`Duplicate agent profile id: ${agent.id}`);
		ids.add(agent.id);
		if (!findAgentBlueprint(agent.blueprintId) && agent.systemPrompt === undefined) {
			throw new Error(`Unknown agent blueprint: ${agent.blueprintId}`);
		}
		if (agent.scope.kind === "library") {
			const handle = normalizeMentionHandle(agent.mentionHandle);
			if (libraryHandles.has(handle)) throw new Error(`Duplicate library agent handle: ${agent.mentionHandle}`);
			libraryHandles.add(handle);
		}
	}
	const teamIds = new Set<string>();
	for (const candidate of document.teams) {
		if (teamIds.has(candidate.id)) throw new Error(`Duplicate team id: ${candidate.id}`);
		teamIds.add(candidate.id);
		assertTeamInvariants(candidate, document.agents);
		requireTeamPolicies(candidate.orchestrationPolicyId, candidate.contextPolicyId, registry);
	}
	for (const agent of document.agents) {
		if (agent.scope.kind === "team" && !teamIds.has(agent.scope.teamId)) {
			throw new Error(`Team-scoped agent references an unknown team: ${agent.id}`);
		}
	}
	return document;
}
export function parseTeamSessionDocument(value: unknown): TeamSessionDocument {
	if (!Value.Check(TeamSessionDocumentSchema, value)) throw new Error("Invalid Agent Team session document");
	const session: ParsedTeamSessionDocument = value;
	const eventIds = new Set<string>();
	for (const event of session.events) {
		if (eventIds.has(event.id)) throw new Error(`Duplicate team event id: ${event.id}`);
		eventIds.add(event.id);
	}
	assertTeamSessionInvariants(session);
	return session;
}

export function parseUpdateTeamSessionModelSettingsInput(value: unknown): UpdateTeamSessionModelSettingsInput {
	if (!Value.Check(UpdateTeamSessionModelSettingsInputSchema, value)) {
		throw new Error("Invalid Team session model settings input");
	}
	return value;
}

function assertTeamSessionInvariants(session: TeamSessionDocument): void {
	const memberIds = new Set(Object.keys(session.memberHandles));
	const activeMemberIds = new Set(session.activeMemberIds ?? Object.keys(session.memberRuntime));
	if (!activeMemberIds.has(session.leaderMemberId)) throw new Error("Team session leader is not an active member");
	if ([...activeMemberIds].some((memberId) => !memberIds.has(memberId))) {
		throw new Error("Team session active roster references an unknown historical member");
	}
	const runtimeMemberIds = Object.keys(session.memberRuntime);
	const allowsPartialRuntime = session.runtimeStatus === "preparing" || session.runtimeStatus === "failed";
	if (
		runtimeMemberIds.some((memberId) => !activeMemberIds.has(memberId)) ||
		(!allowsPartialRuntime && runtimeMemberIds.length !== activeMemberIds.size)
	) {
		throw new Error("Team session runtime members do not match the active roster");
	}
	for (const event of session.events) {
		if (event.type === "user-message" && event.targetMemberIds.some((memberId) => !memberIds.has(memberId))) {
			throw new Error(`Team session event targets an unknown member: ${event.id}`);
		}
		if (event.type === "member-result" && !memberIds.has(event.memberId)) {
			throw new Error(`Team session result belongs to an unknown member: ${event.id}`);
		}
		if (
			event.type === "member-delegation" &&
			(!memberIds.has(event.sourceMemberId) || !memberIds.has(event.targetMemberId))
		) {
			throw new Error(`Team session delegation references an unknown member: ${event.id}`);
		}
	}
	// Delivery receipts may reference ordinary coordination Conversation messages,
	// which intentionally are not duplicated into the legacy `events` array.
}

export function parseCreateAgentProfileInput(value: unknown): CreateAgentProfileInput {
	if (!Value.Check(CreateAgentProfileInputSchema, value)) throw new Error("Invalid create agent profile input");
	return value as CreateAgentProfileInput;
}

export function parseUpdateAgentProfileInput(value: unknown): UpdateAgentProfileInput {
	if (!Value.Check(UpdateAgentProfileInputSchema, value)) throw new Error("Invalid update agent profile input");
	return value as UpdateAgentProfileInput;
}

export function parseDeleteAgentProfileInput(value: unknown): DeleteAgentProfileInput {
	if (!Value.Check(DeleteAgentProfileInputSchema, value)) throw new Error("Invalid delete agent profile input");
	return value as DeleteAgentProfileInput;
}

export function parseCreateTeamInput(value: unknown): CreateTeamInput {
	if (!Value.Check(CreateTeamInputSchema, value)) throw new Error("Invalid create team input");
	return value as CreateTeamInput;
}

export function parseUpdateTeamInput(value: unknown): UpdateTeamInput {
	if (!Value.Check(UpdateTeamInputSchema, value)) throw new Error("Invalid update team input");
	return value as UpdateTeamInput;
}

export function parseDeleteTeamInput(value: unknown): DeleteTeamInput {
	if (!Value.Check(DeleteTeamInputSchema, value)) throw new Error("Invalid delete team input");
	return value as DeleteTeamInput;
}

export function parseSendTeamMessageInput(value: unknown): SendTeamMessageInput {
	if (!Value.Check(SendTeamMessageInputSchema, value)) throw new Error("Invalid send team message input");
	const input = value as SendTeamMessageInput;
	if (input.text.trim().length === 0 && !input.attachments?.length) {
		throw new Error("Invalid send team message input");
	}
	return input;
}
