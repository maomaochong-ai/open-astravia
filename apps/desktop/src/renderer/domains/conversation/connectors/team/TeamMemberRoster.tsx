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
	/** 查看成员会话时，胶囊条最左侧的「主会话」入口。 */
	readonly onBackToTeam?: () => void;
	/** 团队设置入口，挂在胶囊条最右侧。 */
	readonly onOpenSettings?: () => void;
}

/**
 * 页头标题下方的成员胶囊条：一人一枚胶囊、直接写名字，点开对应成员的独立会话。
 * 头像组挤在标题右侧时既认不出人也抢标题的位置，所以整条挪到标题下方。
 *
 * 胶囊条同时承担会话内的导航职责：最左侧的「主会话」胶囊取代了页头返回按钮，
 * 最右侧的齿轮取代了页头的团队设置按钮，让同一组上下文动作集中在一处。
 */
export function TeamMemberRoster({
	members,
	leaderMemberId,
	leaderLabel,
	memberRuntimeIds,
	activeMemberId,
	onOpenMember,
	onBackToTeam,
	onOpenSettings,
}: TeamMemberRosterProps): JSX.Element | null {
	const { t } = useTranslation("agent-teams");
	if (members.length === 0) return null;

	return (
		// 左内边距与页头保持一致，胶囊条正对标题起始位置。设置按钮留在滚动区之外，
		// 成员较多时不会被横向滚动带走。
		<div className="flex min-w-0 shrink-0 items-center gap-1.5 px-3 pb-2">
			<div
				role="group"
				aria-label={t("chat.memberSessions")}
				className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar"
			>
				{activeMemberId && onBackToTeam ? (
					<button
						type="button"
						data-team-session-back="true"
						title={t("chat.backToTeam")}
						aria-label={t("chat.backToTeam")}
						className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onClick={onBackToTeam}
					>
						<span className="icon-[solar--users-group-rounded-bold] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						<span>{t("chat.mainSession")}</span>
					</button>
				) : null}
				{members.map((member) => {
					const runtimeId = memberRuntimeIds?.[member.id];
					const active = member.id === activeMemberId;
					const streaming = member.status === "working";
					return (
						<button
							key={member.id}
							type="button"
							disabled={!runtimeId}
							data-member-session-id={member.id}
							data-member-session-active={active ? "true" : undefined}
							data-member-session-streaming={streaming ? "true" : undefined}
							aria-pressed={active}
							title={t("chat.memberSession", { name: member.name })}
							aria-label={t("chat.memberSession", { name: member.name })}
							className={cn(
								"relative flex h-7 shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
								active
									? "bg-primary/15 text-primary"
									: "bg-muted text-foreground hover:bg-accent",
							)}
							onClick={() => onOpenMember(member.id)}
						>
							{streaming ? (
								<span
									className="team-pill-sweep pointer-events-none absolute inset-0 overflow-hidden rounded-full"
									aria-hidden="true"
								/>
							) : null}
							<span className="relative flex shrink-0">
								<AgentAvatarView
									name={member.name}
									avatar={member.avatar}
									blueprintId={member.blueprintId}
									active={active}
									size="md"
								/>
								{streaming ? (
									<span
										className="team-pill-live-dot absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background"
										aria-hidden="true"
									/>
								) : null}
							</span>
							{member.id === leaderMemberId ? (
								<span
									className="icon-[solar--crown-star-bold] relative h-3.5 w-3.5 shrink-0 text-amber-400"
									title={leaderLabel}
									aria-hidden="true"
								/>
							) : null}
							<span className="relative max-w-[9rem] truncate">{member.name}</span>
						</button>
					);
				})}
			</div>
			{onOpenSettings ? (
				<button
					type="button"
					data-team-settings="true"
					title={t("chat.configure")}
					aria-label={t("chat.configure")}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					onClick={onOpenSettings}
				>
					<span className="icon-[solar--settings-linear] h-3.5 w-3.5" aria-hidden="true" />
				</button>
			) : null}
		</div>
	);
}
