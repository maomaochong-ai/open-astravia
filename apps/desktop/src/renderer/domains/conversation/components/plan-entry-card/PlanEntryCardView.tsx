import { PlanStatusBadge } from "@shared/components/PlanStatusBadge";
import type { PlanOutline } from "../../services/plan-review";

export interface PlanEntryCardLabels {
	title: string;
	/** 计划里识别不出步骤时为空串。 */
	stepCount: string;
	moreSteps: string;
	open: string;
	approved: string;
}

export interface PlanEntryCardViewProps {
	outline: PlanOutline;
	labels: PlanEntryCardLabels;
	onOpen: () => void;
}

/**
 * 消息列表里的计划入口：一张整体可点的卡片，点开右侧活动面板的计划页。
 * 它是导航入口而不是操作按钮，所以是一个原生 button；列表里只预览前几步，完整计划在面板里看。
 */
export function PlanEntryCardView({ outline, labels, onOpen }: PlanEntryCardViewProps): JSX.Element {
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-label={`${labels.title} · ${labels.open}`}
			className="group/plan my-1 block w-full max-w-xl rounded-xl border border-border/50 bg-card/40 text-left outline-none transition-colors duration-200 hover:border-primary/40 hover:bg-card/60 focus-visible:border-ring"
		>
			<span className="flex items-center gap-3 px-3.5 pb-3 pt-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<span className="icon-[solar--checklist-minimalistic-linear] h-4 w-4" />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex items-center gap-2">
						<span className="truncate text-[13px] font-medium text-foreground">{labels.title}</span>
						<PlanStatusBadge tone="approved" label={labels.approved} />
					</span>
					{labels.stepCount ? (
						<span className="truncate text-[11px] text-muted-foreground">{labels.stepCount}</span>
					) : null}
				</span>
				<span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors group-hover/plan:text-primary">
					{labels.open}
					<span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 transition-transform duration-200 group-hover/plan:translate-x-0.5" />
				</span>
			</span>
			{outline.previewSteps.length > 0 ? (
				<span className="flex flex-col gap-1 border-t border-border/40 px-3.5 py-2.5">
					{outline.previewSteps.map((step) => (
						<span key={step.number} className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
							<span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">
								{step.number}
							</span>
							<span className="min-w-0 flex-1 truncate">{step.title}</span>
						</span>
					))}
					{outline.remainingSteps > 0 ? (
						<span className="pl-6 text-[11px] text-muted-foreground/60">{labels.moreSteps}</span>
					) : null}
				</span>
			) : null}
		</button>
	);
}
