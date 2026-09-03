import type { PromptAttachmentRef } from "@vetta/runtime-core";
import type {
	ConversationAuthorReference,
	ConversationMessageRecord,
	ConversationMessageStreamEvent,
} from "@vetta/runtime-core/conversation";

export const AGENT_TEAM_SCHEMA_VERSION = 1 as const;

export type AgentAbilityKind = "skill" | "scene" | "mcp" | "plugin" | (string & {});

export interface AgentAbilitySelection {
	/**
	 * `all` inherits every globally enabled capability, including capabilities installed later.
	 * Missing values are legacy documents and therefore retain the previous `custom` semantics.
	 */
	readonly selectionMode?: "all" | "custom";
	readonly skills: readonly string[];
	readonly mcpServers: readonly string[];
	readonly plugins: readonly string[];
	/** Extension-owned capability selections. Keys are extension IDs; values are resource IDs. */
	readonly extensions?: Readonly<Record<string, readonly string[]>>;
}

export type AgentProfileScope = { readonly kind: "library" } | { readonly kind: "team"; readonly teamId: string };

export interface AgentProfile {
	readonly id: string;
	readonly revision: number;
	readonly name: string;
	readonly description: string;
	readonly avatar?: string;
	readonly mentionHandle: string;
	readonly blueprintId: string;
	/** Stable application-owned preset identity. Preset prompts and identity are not user editable. */
	readonly presetId?: string;
	readonly abilities: AgentAbilitySelection;
	readonly scope: AgentProfileScope;
	readonly copiedFrom?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export type TeamAgentBinding =
	| { readonly kind: "reference"; readonly agentProfileId: string }
	| { readonly kind: "copy"; readonly agentProfileId: string };

export interface TeamMember {
	readonly id: string;
	readonly handle: string;
	readonly binding: TeamAgentBinding;
}

export interface TeamDefinition {
	readonly id: string;
	readonly revision: number;
	readonly name: string;
	readonly description: string;
	readonly leaderMemberId: string;
	readonly members: readonly TeamMember[];
	readonly orchestrationPolicyId: string;
	readonly contextPolicyId: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface AgentTeamDocument {
	readonly schemaVersion: typeof AGENT_TEAM_SCHEMA_VERSION;
	/** One-time seed/migration marker. It prevents deleted user data from being re-created on every read. */
	readonly presetVersion?: number;
	readonly revision: number;
	readonly agents: readonly AgentProfile[];
	readonly teams: readonly TeamDefinition[];
}

export interface TeamMemberRuntimeState {
	readonly sessionId: string;
	readonly sessionPath: string;
	/** Profile identity is optional only for sessions written before preset-aware reconfiguration. */
	readonly agentProfileId?: string;
	readonly agentProfileRevision: number;
	readonly deliveredEventIds: readonly string[];
	/** Latest immutable public checkpoint referenced by this member's private context. */
	readonly sharedCheckpointId?: string;
}

export interface TeamCoordinationRuntimeState {
	readonly sessionId: string;
	readonly sessionPath: string;
}

/**
 * Schema-v1 compatibility payload. Current Team conversations store ordinary
 * Conversation messages and durable work items instead of this event union.
 */
export type LegacyTeamFeedEvent =
	| {
			readonly type: "user-message";
			readonly id: string;
			readonly requestId: string;
			readonly text: string;
			readonly targetMemberIds: readonly string[];
			readonly attachments?: readonly PromptAttachmentRef[];
			readonly timestamp: number;
	  }
	| {
			readonly type: "member-delegation";
			readonly id: string;
			readonly requestId: string;
			readonly sourceMemberId: string;
			readonly targetMemberId: string;
			readonly objective: string;
			readonly timestamp: number;
	  }
	| {
			readonly type: "member-result";
			readonly id: string;
			readonly requestId: string;
			readonly memberId: string;
			readonly sourceTurnId: string;
			readonly text: string;
			readonly timestamp: number;
	  };

export interface TeamSessionDocument {
	readonly schemaVersion: typeof AGENT_TEAM_SCHEMA_VERSION;
	readonly revision: number;
	readonly id: string;
	readonly teamId: string;
	/** Team definition revision last reconciled into the active runtime roster. */
	readonly teamRevision?: number;
	readonly name: string;
	readonly cwd: string;
	readonly orchestrationPolicyId?: string;
	readonly contextPolicyId?: string;
	readonly leaderMemberId: string;
	/** Active roster; omitted by legacy sessions whose runtime map was the roster. */
	readonly activeMemberIds?: readonly string[];
	readonly memberHandles: Readonly<Record<string, string>>;
	readonly createdAt: number;
	readonly updatedAt: number;
	/** Ordinary Conversation that stores the public Team timeline. Optional only for legacy sessions. */
	readonly coordinationRuntime?: TeamCoordinationRuntimeState;
	/** @deprecated Read-only schema-v1 migration input. New messages exist only in coordinationRuntime. */
	readonly events: readonly LegacyTeamFeedEvent[];
	readonly memberRuntime: Readonly<Record<string, TeamMemberRuntimeState>>;
}

export interface AgentProfileUpdateImpact {
	readonly agentProfileId: string;
	readonly teamIds: readonly string[];
	readonly teamNames: readonly string[];
}

export interface AgentProfileDeleteTeamImpact {
	readonly teamId: string;
	readonly teamRevision: number;
	readonly teamName: string;
	readonly removedMemberIds: readonly string[];
	readonly deletesTeam: boolean;
	readonly nextLeaderMemberId?: string;
	readonly nextLeaderName?: string;
}

export interface AgentProfileDeleteImpact {
	readonly agentProfileId: string;
	readonly teams: readonly AgentProfileDeleteTeamImpact[];
}

export interface CreateAgentProfileInput {
	readonly name: string;
	readonly description?: string;
	readonly avatar?: string;
	readonly mentionHandle: string;
	readonly blueprintId: string;
	readonly abilities?: Partial<AgentAbilitySelection>;
}
export interface UpdateAgentProfileInput {
	readonly expectedRevision: number;
	readonly name: string;
	readonly description: string;
	readonly avatar?: string;
	readonly mentionHandle: string;
	readonly abilities: AgentAbilitySelection;
}
export interface DeleteAgentProfileInput {
	readonly expectedRevision: number;
	/** Required when references exist so deletion cannot cascade to teams the user did not review. */
	readonly expectedTeamIds?: readonly string[];
	/** Reviewed team revisions; prevents a same-team roster change from reusing stale confirmation. */
	readonly expectedTeamRevisions?: Readonly<Record<string, number>>;
}
export interface CreateTeamMemberInput {
	readonly agentProfileId: string;
	readonly handle: string;
	readonly bindingKind: "reference" | "copy";
	readonly leader: boolean;
}
export interface CreateTeamInput {
	readonly name: string;
	readonly description?: string;
	readonly members: readonly CreateTeamMemberInput[];
	readonly orchestrationPolicyId?: string;
	readonly contextPolicyId?: string;
}

export type UpdateTeamMemberInput =
	| {
			readonly kind: "existing";
			readonly memberId: string;
			readonly leader: boolean;
	  }
	| {
			readonly kind: "new";
			readonly agentProfileId: string;
			readonly bindingKind: "reference" | "copy";
			readonly leader: boolean;
	  };

export interface UpdateTeamInput {
	readonly expectedRevision: number;
	readonly name: string;
	readonly description: string;
	readonly members: readonly UpdateTeamMemberInput[];
}

export interface DeleteTeamInput {
	readonly expectedRevision: number;
}
export interface SendTeamMessageInput {
	readonly requestId: string;
	readonly text: string;
	readonly targetMemberIds: readonly string[];
	readonly attachments?: readonly PromptAttachmentRef[];
}

/** Business activity remains separate from the ordinary message type. */
export interface TeamSessionActivity {
	readonly kind: "delegation";
	readonly id: string;
	readonly requestId: string;
	readonly sourceMemberId: string;
	readonly targetMemberId: string;
	readonly objective: string;
	readonly state: "queued" | "running" | "waiting" | "attention-required" | "completed" | "failed" | "cancelled";
	readonly timestamp: number;
}

/** Renderer/IPC read model; never persisted as a second Conversation format. */
export interface TeamSessionSnapshot {
	readonly session: TeamSessionDocument;
	readonly conversationRevision: number;
	readonly messages: readonly ConversationMessageRecord[];
	readonly activities: readonly TeamSessionActivity[];
}

/** Stable renderer bookmark for reopening an ordinary coordination Conversation. */
export interface TeamSessionReference {
	readonly id: string;
	readonly coordinationSessionPath: string;
}

/** Safe renderer-facing updates plus product-neutral ordinary message events. */
export type TeamSessionStreamEvent =
	| {
			type: "session-snapshot";
			teamSessionId: string;
			snapshot: TeamSessionSnapshot;
			activeMessageEvents: readonly ConversationMessageStreamEvent[];
	  }
	| {
			type: "session-updated";
			teamSessionId: string;
			snapshot: TeamSessionSnapshot;
	  }
	| ConversationMessageStreamEvent;

export interface TeamSharedContextRecord {
	readonly eventId: string;
	readonly type: "agent-team.user-message.v1" | "agent-team.member-result.v1" | "agent-team.member-delegation.v1";
	readonly text: string;
	readonly timestamp: number;
	readonly artifactRefs?: readonly PromptAttachmentRef[];
	readonly metadata: {
		readonly teamSessionId: string;
		readonly sourceMemberId?: string;
		readonly author?: ConversationAuthorReference;
		readonly requestId: string;
	};
}

export interface AgentBlueprint {
	readonly id: string;
	readonly nameKey: string;
	readonly descriptionKey: string;
	readonly systemPrompt: string;
	readonly defaultAbilities: AgentAbilitySelection;
}

export const EMPTY_AGENT_ABILITIES: AgentAbilitySelection = Object.freeze({
	selectionMode: "custom",
	skills: Object.freeze([]),
	mcpServers: Object.freeze([]),
	plugins: Object.freeze([]),
});
