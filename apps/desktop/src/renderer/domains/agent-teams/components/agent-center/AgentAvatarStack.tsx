import type { AgentProfile } from "@vetta/agent-team";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import { AgentAvatarView } from "@vetta/theme-ui/chat";

export interface AgentAvatarStackProps {
	readonly agents: readonly AgentProfile[];
	readonly leaderId?: string;
	readonly emptyIcon?: boolean;
}

/** 编队头像组：同一支团队的成员在这里以叠加头像的形式出现。 */
export function AgentAvatarStack({ agents, leaderId, emptyIcon = false }: AgentAvatarStackProps): JSX.Element {
	if (agents.length === 0 && emptyIcon) {
		return (
			<span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-muted-foreground ring-1 ring-card">
				<span className="icon-[solar--users-group-rounded-linear] h-3.5 w-3.5" aria-hidden="true" />
			</span>
		);
	}

	return (
		<div className="flex items-center -space-x-1">
			{agents.map((agent, index) => (
				<span
					key={agent.id}
					title={agent.name}
					style={{ zIndex: agents.length - index }}
					className="relative flex shrink-0"
				>
					<AgentAvatarView
						name={agent.name}
						avatar={agentAvatarUrl(agent)}
						background={agent.avatarBackground}
						blueprintId={agent.blueprintId}
						seed={agent.id}
						size="lg"
						className="ring-card"
					/>
					{agent.id === leaderId && (
						<span className="absolute inset-x-0 bottom-0 h-1 rounded-b-full bg-primary" aria-hidden="true" />
					)}
				</span>
			))}
		</div>
	);
}
