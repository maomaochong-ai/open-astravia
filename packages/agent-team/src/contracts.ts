import type { PromptAttachmentRef, SessionExecutionMode } from "@vetta/runtime-core";
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
	/** 头像底座：`tint:<preset>` 选预设渐变，`#rrggbb` 用自定义纯色；缺省按身份自动分配。 */
	readonly mentionHandle: string;
	readonly blueprintId: string;
	/** Optional file-backed override; absent means use the registered blueprint default. */
	readonly systemPrompt?: string;
	readonly abilities: AgentAbilitySelection;
	readonly scope: AgentProfileScope;
	readonly copiedFrom?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export type TeamAgentBinding =
	| { readonly kind: "reference"; readonly agentProfileId: string }
	| { readonly kind: "copy"; readonly agentProfileId: string };

/**
 * 成员在**本团队内**的任务书：叠加在 Agent Profile 之上的增量，不改动本体。
 * 空白字段一律等同于缺省，即回到本体（见 ADR-0109）。
 */
export interface TeamMemberAssignment {
	/** 覆盖全队可见的职责摘要；缺省沿用 Agent Profile 的 description。 */
	readonly responsibility?: string;
	/** 追加在本体人格之后的团队内交待，不替换 blueprint 的协作纪律，也不进入共享名册。 */
	readonly instructions?: string;
}

export interface TeamMember {
	readonly id: string;
	readonly handle: string;
	readonly binding: TeamAgentBinding;
	readonly assignment?: TeamMemberAssignment;
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
	readonly revision: number;
	readonly agents: readonly AgentProfile[];
	readonly teams: readonly TeamDefinition[];
}

export interface TeamMemberRuntimeState {
	readonly sessionId: string;
	readonly sessionPath: string;
	/** Profile identity is optional only for sessions written before profile-aware reconfiguration. */
	readonly agentProfileId?: string;
	readonly agentProfileRevision: number;
	/** 已生效的团队任务书指纹；与 Profile 修订一起构成成员运行时的配置身份。 */
	readonly assignmentFingerprint?: string;
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
	/** Stable activity workspace selected when this Team session was created. */
	readonly workspaceId?: string;
	/** Semantic workspace ownership; UI projections must not infer this from cwd or workspaceId. */
	readonly workspaceKind?: TeamSessionWorkspaceKind;
	/** Execution mode shared by the coordination and member runtimes in this Team session. */
	readonly executionMode?: SessionExecutionMode;
	readonly modelSettings?: TeamSessionModelSettings;
	/** Team definition revision last reconciled into the active runtime roster. */
	readonly teamRevision?: number;
	/** Conversation title generated from the first user message; independent of the Team definition name. */
	readonly title?: string;
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
	/** Runtime preparation is eager but may complete after the session record is visible. */
	readonly runtimeStatus?: "preparing" | "ready" | "failed";
	/** @deprecated Read-only schema-v1 migration input. New messages exist only in coordinationRuntime. */
	readonly events: readonly LegacyTeamFeedEvent[];
	readonly memberRuntime: Readonly<Record<string, TeamMemberRuntimeState>>;
}

export interface TeamSessionModelSettings {
	readonly modelKey: string;
	readonly reasoning?: string;
}

/** `team-default` is retained for sessions created before per-session workspaces. */
export type TeamSessionWorkspaceKind = "team-default" | "session" | "project";

/** Optional project workspace override captured when a Team session is created. */
export type TeamSessionWorkspaceSelection = {
	readonly kind: "project";
	readonly path: string;
};

export interface UpdateTeamSessionModelSettingsInput extends TeamSessionModelSettings {}

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
	readonly systemPrompt?: string;
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
	readonly assignment?: TeamMemberAssignment;
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
			readonly assignment?: TeamMemberAssignment;
	  }
	| {
			readonly kind: "new";
			readonly agentProfileId: string;
			readonly bindingKind: "reference" | "copy";
			readonly leader: boolean;
			readonly assignment?: TeamMemberAssignment;
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
	/** Structured member tokens emitted by the composer; plain `@text` never creates these. */
	readonly memberMentions?: readonly TeamUserMessageMention[];
	readonly targetMemberIds: readonly string[];
	readonly attachments?: readonly PromptAttachmentRef[];
	/** Per-turn model selection applied consistently to every initially addressed member. */
	readonly modelKey?: string;
	readonly reasoning?: string;
	/** Enter 等待完整 Turn；Ctrl+Enter 在当前模型/工具安全边界优先注入。 */
	readonly streamingBehavior?: "steer" | "followUp";
}

export interface TeamUserMessageMention {
	readonly participantId: string;
	readonly handle: string;
	/** UTF-16 offsets into `SendTeamMessageInput.text`. */
	readonly start: number;
	readonly end: number;
}

/** Initial settings captured when a new Team session is reserved for first paint. */
export interface CreateTeamSessionRecordOptions {
	/** Renderer-reserved UUID used to route before Runtime initialization completes. */
	readonly sessionId?: string;
	readonly executionMode?: SessionExecutionMode;
	/** Omitted to allocate a new workspace owned by this Team session. */
	readonly workspace?: TeamSessionWorkspaceSelection;
}

/** Business activity remains separate from the ordinary message type. */
export interface TeamSessionActivity {
	readonly kind: "delegation";
	readonly id: string;
	readonly requestId: string;
	/** Tool call that created the work item, when the activity came from Team collaboration tooling. */
	readonly originToolCallId?: string;
	/** Member turn that produced the reply, when the collaboration attempt is known. */
	readonly sourceTurnId?: string;
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
	/** Explicit user-addressing projection. Empty recipients mean the message belongs to the aggregate view only. */
	readonly userMessageAnnotations?: readonly {
		readonly messageEntryId: string;
		readonly participantIds: readonly string[];
		readonly mentions: readonly TeamUserMessageMention[];
	}[];
}

/** Stable renderer bookmark for reopening an ordinary coordination Conversation. */
export interface TeamSessionReference {
	readonly id: string;
	readonly coordinationSessionPath: string;
}

/** Team-owned catalog projection; Conversation remains the only message/session storage format. */
export interface TeamSessionListItem extends TeamSessionReference {
	readonly title: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	/** Optional only for catalog records created before workspace ownership was explicit. */
	readonly workspaceKind?: TeamSessionWorkspaceKind;
	readonly workspaceId?: string;
	readonly cwd?: string;
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

/**
 * Blueprint 的来源。内置的由宿主代码定义；插件的随插件装卸，宿主侧不可编辑。
 *
 * 区分来源是为了让 UI 讲清楚「这个智能体为什么不能用了」——插件禁用后它的 blueprint
 * 会消失，引用它的档案要降级展示而不是被当成脏数据。
 */
export type AgentBlueprintSource =
	| { readonly kind: "builtin" }
	| { readonly kind: "plugin"; readonly pluginId: string };

export interface AgentBlueprint {
	readonly id: string;
	/** i18n key；插件 blueprint 走 {@link AgentBlueprint.name} 的字面量，二者取其一。 */
	readonly nameKey: string;
	readonly descriptionKey: string;
	/** 插件 blueprint 的字面名称（已按插件 locales 解析）。存在时优先于 `nameKey`。 */
	readonly name?: string;
	readonly description?: string;
	readonly systemPrompt: string;
	readonly defaultAbilities: AgentAbilitySelection;
	/** 缺省视为内置。 */
	readonly source?: AgentBlueprintSource;
	/** 头像 URL；插件 blueprint 由宿主解析成插件资源地址。 */
	readonly avatarUrl?: string;
	/**
	 * 强制随该智能体激活的插件能力，用户在能力面板里关不掉。
	 *
	 * 插件智能体的存在意义就是操作它自己的插件：全局把插件能力关掉更可能是「不想在普通
	 * 对话里看到」，而不是「选了这个智能体也不许用」。运行时按并集解析，不写进用户档案。
	 */
	readonly pinnedPlugins?: readonly string[];
}

export const EMPTY_AGENT_ABILITIES: AgentAbilitySelection = Object.freeze({
	selectionMode: "custom",
	skills: Object.freeze([]),
	mcpServers: Object.freeze([]),
	plugins: Object.freeze([]),
});
