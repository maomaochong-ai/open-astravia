import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../TextBlock";
import { getStringArg } from "./shared/parse-tool";

/** Minimal block shape; avoid @shared/store so inventory is not dataHeavy. */
interface ExitPlanModeBlock {
	args: Record<string, unknown>;
	status: string;
	uiDetails?: { planReview?: { decision: "approve" | "revise" | "cancelled"; plan?: string } };
}

const DECISION_STYLE = {
	approve: { icon: "icon-[solar--check-circle-linear]", className: "bg-emerald-500/15 text-emerald-400" },
	revise: { icon: "icon-[solar--pen-2-linear]", className: "bg-amber-500/15 text-amber-400" },
	cancelled: { icon: "icon-[solar--clock-circle-linear]", className: "bg-accent/60 text-muted-foreground" },
	pending: { icon: "icon-[solar--clock-circle-linear]", className: "bg-primary/10 text-primary" },
} as const;

/**
 * exit_plan_mode 的 transcript 视图：回显计划与用户的审批结论。
 * 批准时展示定稿（用户可能改过），其余情况展示模型提交的版本。
 */
export function ExitPlanModeView({ block }: { block: ExitPlanModeBlock }): JSX.Element | null {
	const { t } = useTranslation("chat");
	const resolution = block.uiDetails?.planReview;
	const plan = resolution?.plan ?? getStringArg(block.args, "plan");
	if (!plan) return null;
	const state = resolution?.decision ?? (block.status === "pending" ? "pending" : "cancelled");
	const style = DECISION_STYLE[state];
	const label = {
		approve: t("planMode.toolCard.approved"),
		revise: t("planMode.toolCard.changesRequested"),
		cancelled: t("planMode.toolCard.dismissed"),
		pending: t("planMode.toolCard.pending"),
	}[state];

	return (
		<div className="rounded-xl border border-border/50 bg-card/40 px-3.5 pb-3 pt-3">
			<div className="mb-2 flex items-center justify-between gap-2">
				<span className="text-[12px] font-medium text-foreground">{t("planMode.toolCard.title")}</span>
				<span
					className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-4 ${style.className}`}
				>
					<span className={`${style.icon} h-3 w-3`} />
					{label}
				</span>
			</div>
			<MarkdownContent text={plan} className="text-[13px]" />
		</div>
	);
}
