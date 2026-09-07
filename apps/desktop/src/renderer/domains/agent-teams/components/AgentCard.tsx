import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type { AgentBlueprint, AgentProfile } from "@vetta/agent-team";
import { Button } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { AgentAvatarView } from "@vetta/theme-ui/chat";

export interface AgentCardProps {
	readonly agent: AgentProfile;
	readonly blueprint?: AgentBlueprint;
	/** 已拉拢进阵容或已选中的强调态。 */
	readonly selected?: boolean;
	/** 组队模式下右上角的拉入/移出标记；常态不显示。 */
	readonly marker?: "recruit" | "recruited";
	/** 团队花名册里的队长标记。 */
	readonly leader?: boolean;
	/** 尚未保存的新成员：先保存团队才能配置能力。 */
	readonly pending?: boolean;
	readonly onActivate: () => void;
	readonly onMakeLeader?: () => void;
	readonly onRemove?: () => void;
}

/** 智能体卡片：智能体中心与团队花名册共用同一套视觉。 */
export function AgentCard({
	agent,
	blueprint,
	selected = false,
	marker,
	leader = false,
	pending = false,
	onActivate,
	onMakeLeader,
	onRemove,
}: AgentCardProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const hasControls = Boolean(onMakeLeader || onRemove);

	return (
		<div
			className={[
				"group relative rounded-xl border transition-colors duration-200",
				selected
					? "border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/30"
					: "border-border/50 bg-card/40 hover:border-primary/40 hover:bg-card/60",
			].join(" ")}
		>
			<button
				type="button"
				onClick={onActivate}
				aria-label={agent.name}
				aria-pressed={marker ? marker === "recruited" : undefined}
				className="flex w-full cursor-pointer items-start gap-3.5 p-4 text-left outline-none"
			>
				<AgentAvatarView
					name={agent.name}
					avatar={agentAvatarUrl(agent)}
					background={agent.avatarBackground}
					blueprintId={agent.blueprintId}
					seed={agent.id}
					size="hero"
				/>

				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex items-baseline gap-1.5">
						<span className="truncate text-[14px] font-semibold tracking-tight text-foreground">{agent.name}</span>
						<span className="shrink-0 text-[12px] text-muted-foreground">
							{blueprint ? t(blueprint.nameKey as never) : agent.blueprintId}
						</span>
					</span>
					<span className="mt-1.5 line-clamp-2 min-h-9 text-[12px] leading-relaxed text-muted-foreground/80">
						{agent.description || t("settings.profileMissing")}
					</span>
					{pending && (
						<span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-400">
							<span className="icon-[solar--info-circle-linear] h-3 w-3" aria-hidden="true" />
							{t("settings.saveBeforeEditing")}
						</span>
					)}
				</span>
			</button>

			{marker && (
				<span
					className={[
						"pointer-events-none absolute right-3 top-3 flex h-4.5 w-4.5 items-center justify-center rounded-full",
						marker === "recruited" ? "bg-primary text-primary-foreground" : "bg-accent/60 text-muted-foreground",
					].join(" ")}
					aria-hidden="true"
				>
					<span
						className={
							marker === "recruited"
								? "icon-[solar--check-read-linear] h-3 w-3"
								: "icon-[solar--add-circle-linear] h-3 w-3"
						}
					/>
				</span>
			)}

			{hasControls && (
				<div className="absolute right-2 top-2 flex items-center gap-0.5">
					{leader ? (
						<span
							className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400"
							title={t("settings.leader")}
						>
							<span className="icon-[solar--crown-star-bold] h-3 w-3" aria-hidden="true" />
							{t("settings.leader")}
						</span>
					) : (
						onMakeLeader && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="h-7 w-7 rounded-lg text-muted-foreground/60 opacity-0 transition-opacity hover:text-amber-400 focus-visible:opacity-100 group-hover:opacity-100"
								title={t("settings.makeLeader", { name: agent.name })}
								aria-label={t("settings.makeLeader", { name: agent.name })}
								onClick={onMakeLeader}
							>
								<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
							</Button>
						)
					)}
					{onRemove && (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="h-7 w-7 rounded-lg text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
							title={t("teams.removeMember", { name: agent.name })}
							aria-label={t("teams.removeMember", { name: agent.name })}
							onClick={onRemove}
						>
							<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" aria-hidden="true" />
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
