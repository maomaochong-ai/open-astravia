import { cn } from "@shared/lib/utils";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";
import type { TeamChatViewModel } from "./teamChatModel";

export interface TeamMemberRosterProps {
	readonly members: TeamChatViewModel["members"];
	/** 负责人胶囊上额外挂一枚皇冠角标。 */
	readonly leaderMemberId?: string;
	readonly leaderLabel?: string;
	readonly memberRuntimeIds?: TeamChatViewModel["memberRuntimeIds"];
	/** 当前正在查看的成员会话；团队主视图下为空。 */
	readonly activeMemberId?: string;
	readonly onOpenMember: (memberId: string) => void;
}

/**
 * 页头标题下方的成员胶囊条：一人一枚胶囊、直接写名字，点开对应成员的独立会话。
 * 头像组挤在标题右侧时既认不出人也抢标题的位置，所以整条挪到标题下方。
 */
export function TeamMemberRoster({
	members,
	leaderMemberId,
	leaderLabel,
	memberRuntimeIds,
	activeMemberId,
	onOpenMember,
}: TeamMemberRosterProps): JSX.Element | null {
	const { t } = useTranslation("agent-teams");
	if (members.length === 0) return null;

	return (
		<div
			role="group"
			aria-label={t("chat.memberSessions")}
			// 左内边距与页头保持一致，胶囊条正对标题起始位置。
			className="flex min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto px-3 pb-2 no-scrollbar"
		>
			{members.map((member) => {
				const runtimeId = memberRuntimeIds?.[member.id];
				const active = member.id === activeMemberId;
				return (
					<button
						key={member.id}
						type="button"
						disabled={!runtimeId}
						data-member-session-id={member.id}
						data-member-session-active={active ? "true" : undefined}
						aria-pressed={active}
						title={t("chat.memberSession", { name: member.name })}
						aria-label={t("chat.memberSession", { name: member.name })}
						className={cn(
							"flex h-7 shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
							active
								? "bg-primary/15 text-primary"
								: "bg-muted text-foreground hover:bg-accent",
						)}
						onClick={() => onOpenMember(member.id)}
					>
						<AgentAvatarView
							name={member.name}
							avatar={member.avatar}
							blueprintId={member.blueprintId}
							active={active}
							size="md"
						/>
						{member.id === leaderMemberId ? (
							<span
								className="icon-[solar--crown-star-bold] h-3.5 w-3.5 shrink-0 text-amber-400"
								title={leaderLabel}
								aria-hidden="true"
							/>
						) : null}
						<span className="max-w-[9rem] truncate">{member.name}</span>
					</button>
				);
			})}
		</div>
	);
}
