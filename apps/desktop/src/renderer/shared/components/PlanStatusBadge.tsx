export type PlanStatusTone = "pending" | "approved" | "changes-requested" | "dismissed";

const TONE_STYLE: Record<PlanStatusTone, { icon: string; className: string }> = {
	pending: { icon: "icon-[solar--clock-circle-linear]", className: "bg-primary/10 text-primary" },
	approved: { icon: "icon-[solar--check-circle-linear]", className: "bg-emerald-500/15 text-emerald-400" },
	"changes-requested": { icon: "icon-[solar--pen-2-linear]", className: "bg-amber-500/15 text-amber-400" },
	dismissed: { icon: "icon-[solar--clock-circle-linear]", className: "bg-accent/60 text-muted-foreground" },
};

/** 计划的审批状态徽标；会话记录里的计划卡片与活动面板的计划页共用，保证同一状态同一种表达。 */
export function PlanStatusBadge({ tone, label }: { tone: PlanStatusTone; label: string }): JSX.Element {
	const style = TONE_STYLE[tone];
	return (
		<span
			className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-4 ${style.className}`}
		>
			<span className={`${style.icon} h-3 w-3`} />
			{label}
		</span>
	);
}
