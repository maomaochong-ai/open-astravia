import type {
	AgentBlueprint,
	AgentProfile,
	AgentProfileUpdateImpact,
	AgentTeamDocument,
	CreateAgentProfileInput,
	CreateTeamInput,
	DeleteAgentProfileInput,
	SendTeamMessageInput,
	TeamDefinition,
	TeamSessionDocument,
	UpdateAgentProfileInput,
} from "@vetta/agent-team";

export interface DesktopAgentTeamsApi {
	list(): Promise<AgentTeamDocument>;
	listBlueprints(): Promise<readonly AgentBlueprint[]>;
	createAgent(input: CreateAgentProfileInput): Promise<AgentProfile>;
	updateAgent(id: string, input: UpdateAgentProfileInput): Promise<AgentProfile>;
	deleteAgent(id: string, input: DeleteAgentProfileInput): Promise<void>;
	previewAgentUpdate(id: string): Promise<AgentProfileUpdateImpact>;
	createTeam(input: CreateTeamInput): Promise<TeamDefinition>;
	createSession(teamId: string, cwd: string): Promise<TeamSessionDocument>;
	getSession(id: string): Promise<TeamSessionDocument>;
	sendMessage(id: string, input: SendTeamMessageInput): Promise<TeamSessionDocument>;
}
