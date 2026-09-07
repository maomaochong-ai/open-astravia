import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { Button } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { AgentAvatarStack } from "./AgentAvatarStack";

export interface TeamCardProps {
	readonly team: TeamDefinition;
	readonly members: readonly AgentProfile[];
	readonly leaderId?: string;
	readonly selected: boolean;
	readonly onSelect: () => void;
	readonly onOpenChat: () => void;
	readonly onRecruit: () => void;
	readonly onOpenSettings: () => void;
	readonly onDelete: () => void;
}

export function TeamCard({
	team,
	members,
	leaderId,
	selected,
	onSelect,
	onOpenChat,
	onRecruit,
	onOpenSettings,
	onDelete,
}: TeamCardProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const summary = members
		.map((member) => member.name)
		.filter(Boolean)
		.join(" · ");

	return (
		<div
			// 页面级的「点空白处取消选中」靠这个标记判断点击是否落在卡片内，别删。
			data-team-card={team.id}
			className={[
				"group relative flex flex-col justify-between rounded-xl border p-4 transition-colors duration-200",
				selected
					? "border-primary/40 bg-card/70 ring-1 ring-inset ring-primary/30"
					: "border-border/50 bg-card/40 hover:border-primary/40 hover:bg-card/60",
			].join(" ")}
		>
			<button type="button" onClick={onSelect} className="flex flex-col text-left outline-none">
				<span className="flex items-center justify-between gap-2">
					<AgentAvatarStack agents={members} leaderId={leaderId} />
					<span className="shrink-0 text-[11px] text-muted-foreground/70">
						{t("center.expertCount", { count: members.length })}
					</span>
				</span>
				<span className="mt-3.5 truncate text-[13px] font-medium tracking-tight text-foreground">{team.name}</span>
				<span className="mt-1 line-clamp-1 text-[12px] text-muted-foreground/80">
					{team.description || summary}
				</span>
			</button>

			{/* 选中后操作就地长在卡片上：动作与它作用的团队挨在一起，比丢到页面右上角好找。 */}
			<div className="mt-4 flex items-center justify-between gap-1 pt-2">
				{selected ? (
					<div className="flex items-center gap-1">
						{/* 拉拢是这里唯一的正向动作，用 primary 实心把它和「设置 / 删除」两个次要动作分开。 */}
						<Button
							variant="primary"
							size="sm"
							className="h-6 gap-1 rounded-full px-2"
							title={t("center.recruit")}
							aria-label={t("center.recruit")}
							onClick={onRecruit}
						>
							<span className="icon-[solar--user-plus-linear] h-3.5 w-3.5" aria-hidden="true" />
							<span className="text-[11px] font-medium">{t("center.recruitShort")}</span>
						</Button>
						<CardAction
							icon="icon-[solar--settings-linear]"
							label={t("center.teamSettings")}
							onClick={onOpenSettings}
						/>
						<CardAction
							icon="icon-[solar--trash-bin-trash-linear]"
							label={t("center.deleteTeam")}
							danger
							onClick={onDelete}
						/>
					</div>
				) : (
					<span className="truncate text-[11px] text-muted-foreground/60">{t("center.teamSelectHint")}</span>
				)}
				<Button
					variant="ghost"
					size="icon-xs"
					className="h-6 w-6 shrink-0 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
					title={t("center.openTeamChat")}
					onClick={onOpenChat}
				>
					<span className="icon-[solar--arrow-right-up-linear] h-3.5 w-3.5" aria-hidden="true" />
					<span className="sr-only">{t("center.openTeamChat")}</span>
				</Button>
			</div>
		</div>
	);
}

interface CardActionProps {
	readonly icon: string;
	readonly label: string;
	readonly danger?: boolean;
	readonly onClick: () => void;
}

function CardAction({ icon, label, danger = false, onClick }: CardActionProps): JSX.Element {
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			className={[
				"h-6 w-6 rounded-full text-muted-foreground",
				danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-primary/10 hover:text-primary",
			].join(" ")}
			title={label}
			aria-label={label}
			onClick={onClick}
		>
			<span className={`${icon} h-3.5 w-3.5`} aria-hidden="true" />
		</Button>
	);
}
