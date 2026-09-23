import type {
	AgentBlueprint,
	AgentProfile,
	AgentProfileDeleteImpact,
	AgentProfileUpdateImpact,
	AgentTeamDocument,
	CreateAgentProfileInput,
	CreateTeamInput,
	CreateTeamSessionRecordOptions,
	DeleteAgentProfileInput,
	DeleteTeamInput,
	SendTeamMessageInput,
	TeamDefinition,
	TeamSessionListItem,
	TeamSessionReference,
	UpdateAgentProfileInput,
	UpdateTeamInput,
	UpdateTeamSessionModelSettingsInput,
} from "@vetta/agent-team";
import type { SessionExecutionMode } from "@vetta/runtime-core";
import type { TeamMemberModelPreference, TeamMemberModelSelection } from "../../shared/agent-team-member-model.js";
import type { DesktopTeamSidebarConversation } from "../../shared/sidebar-conversation.js";
import type { DesktopTeamSessionSnapshot, DesktopTeamSessionStreamEvent } from "./team-conversation-display.js";

export interface DesktopAgentTeamsApi {
	list(): Promise<AgentTeamDocument>;
	/**
	 * 订阅「配置被主进程改过」：插件装卸、启停与开发态热重载会在用户没动手时重铺插件预设。
	 *
	 * 事件不带文档，收到后自行 `list()`：一份完整配置每次都过 IPC 不值得，而这条事件本就少见。
	 */
	onChanged(listener: () => void): () => void;
	onMemberModelsChanged(listener: (teamId: string) => void): () => void;
	listBlueprints(): Promise<readonly AgentBlueprint[]>;
	createAgent(input: CreateAgentProfileInput): Promise<AgentProfile>;
	updateAgent(id: string, input: UpdateAgentProfileInput): Promise<AgentProfile>;
	deleteAgent(id: string, input: DeleteAgentProfileInput): Promise<void>;
	previewAgentUpdate(id: string): Promise<AgentProfileUpdateImpact>;
	previewAgentDelete(id: string): Promise<AgentProfileDeleteImpact>;
	createTeam(input: CreateTeamInput): Promise<TeamDefinition>;
	updateTeam(id: string, input: UpdateTeamInput): Promise<TeamDefinition>;
	deleteTeam(id: string, input: DeleteTeamInput): Promise<void>;
	createSession(teamId: string): Promise<DesktopTeamSessionSnapshot>;
	createSessionRecord(teamId: string, options?: CreateTeamSessionRecordOptions): Promise<DesktopTeamSessionSnapshot>;
	listSessions(teamId: string): Promise<readonly TeamSessionListItem[]>;
	listSidebarConversations(): Promise<readonly DesktopTeamSidebarConversation[]>;
	renameSession(reference: TeamSessionReference | string, name: string): Promise<DesktopTeamSessionSnapshot>;
	deleteSession(reference: TeamSessionReference | string): Promise<void>;
	updateModelSettings(id: string, input: UpdateTeamSessionModelSettingsInput): Promise<DesktopTeamSessionSnapshot>;
	listMemberModels(teamId: string): Promise<Readonly<Record<string, TeamMemberModelPreference>>>;
	setMemberModel(
		teamId: string,
		memberId: string,
		selection: TeamMemberModelSelection | null,
	): Promise<Readonly<Record<string, TeamMemberModelPreference>>>;
	setExecutionMode(id: string, mode: SessionExecutionMode): Promise<DesktopTeamSessionSnapshot>;
	getSession(reference: TeamSessionReference | string): Promise<DesktopTeamSessionSnapshot>;
	subscribe(id: string, handler: (event: DesktopTeamSessionStreamEvent) => void): Promise<() => void>;
	/** 弹出图片选择框，返回可直接作为 `<img src>` 的头像 URL；用户取消时返回 undefined。 */
	uploadAvatar(): Promise<string | undefined>;
	abort(id: string): Promise<void>;
	sendMessage(id: string, input: SendTeamMessageInput): Promise<DesktopTeamSessionSnapshot>;
}
