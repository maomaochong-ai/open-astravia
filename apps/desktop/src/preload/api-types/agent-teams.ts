import type {
	AgentBlueprint,
	AgentProfile,
	AgentProfileDeleteImpact,
	AgentProfileUpdateImpact,
	AgentTeamDocument,
	CreateAgentProfileInput,
	CreateTeamInput,
	DeleteAgentProfileInput,
	DeleteTeamInput,
	SendTeamMessageInput,
	TeamDefinition,
	TeamSessionListItem,
	TeamSessionReference,
	TeamSessionSnapshot,
	TeamSessionStreamEvent,
	UpdateAgentProfileInput,
	UpdateTeamInput,
	UpdateTeamSessionModelSettingsInput,
} from "@vetta/agent-team";

export interface DesktopAgentTeamsApi {
	list(): Promise<AgentTeamDocument>;
	listBlueprints(): Promise<readonly AgentBlueprint[]>;
	createAgent(input: CreateAgentProfileInput): Promise<AgentProfile>;
	updateAgent(id: string, input: UpdateAgentProfileInput): Promise<AgentProfile>;
	deleteAgent(id: string, input: DeleteAgentProfileInput): Promise<void>;
	previewAgentUpdate(id: string): Promise<AgentProfileUpdateImpact>;
	previewAgentDelete(id: string): Promise<AgentProfileDeleteImpact>;
	createTeam(input: CreateTeamInput): Promise<TeamDefinition>;
	updateTeam(id: string, input: UpdateTeamInput): Promise<TeamDefinition>;
	deleteTeam(id: string, input: DeleteTeamInput): Promise<void>;
	createSession(teamId: string): Promise<TeamSessionSnapshot>;
	listSessions(teamId: string): Promise<readonly TeamSessionListItem[]>;
	updateModelSettings(id: string, input: UpdateTeamSessionModelSettingsInput): Promise<TeamSessionSnapshot>;
	getSession(reference: TeamSessionReference | string): Promise<TeamSessionSnapshot>;
	subscribe(id: string, handler: (event: TeamSessionStreamEvent) => void): Promise<() => void>;
	abort(id: string): Promise<void>;
	sendMessage(id: string, input: SendTeamMessageInput): Promise<TeamSessionSnapshot>;
}
