import { AgentAvatarView } from "@vetta/theme-ui/chat";
import type { TeamMemberViewModel } from "./teamChatModel";

export interface TeamRecipientSelectorProps {
	readonly members: readonly TeamMemberViewModel[];
	readonly leaderRouteLabel: string;
	readonly onSelectLeader: () => void;
	readonly onToggleMember: (memberId: string) => void;
}

/** Props-driven recipient selector for routing a team message. */
export function TeamRecipientSelector({
	members,
	leaderRouteLabel,
	onSelectLeader,
	onToggleMember,
}: TeamRecipientSelectorProps): JSX.Element {
	const hasSelectedMember = members.some((member) => member.selected);
	return (
		<div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 px-3 py-2 no-scrollbar">
			<RoutingButton selected={!hasSelectedMember} label={leaderRouteLabel} onClick={onSelectLeader}>
				<span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-border">
					<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
				</span>
			</RoutingButton>
			{members.map((member) => (
				<RoutingButton
					key={member.id}
					selected={member.selected}
					label={member.name}
					onClick={() => onToggleMember(member.id)}
				>
					<span className="relative">
						<AgentAvatarView
							name={member.name}
							avatar={member.avatar}
							blueprintId={member.blueprintId}
							active={member.selected}
						/>
						{member.status !== "idle" ? (
							<span
								className={[
									"absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-input-bar-bg",
									member.status === "error" ? "bg-destructive" : "animate-pulse bg-primary",
								].join(" ")}
							/>
						) : null}
					</span>
				</RoutingButton>
			))}
		</div>
	);
}

function RoutingButton({
	selected,
	label,
	onClick,
	children,
}: {
	readonly selected: boolean;
	readonly label: string;
	readonly onClick: () => void;
	readonly children: JSX.Element;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={selected}
			title={label}
			className={[
				"inline-flex shrink-0 items-center rounded-full p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30",
				selected ? "bg-primary/15" : "hover:bg-muted",
			].join(" ")}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

