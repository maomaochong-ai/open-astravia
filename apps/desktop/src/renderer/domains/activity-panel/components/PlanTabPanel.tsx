import { PlanStatusBadge } from "@shared/components/PlanStatusBadge";
import { RendererMarkdownContent } from "@shared/components/RendererMarkdownContent";
import { usePlanTabPanelModel } from "../hooks/usePlanTabPanelModel";

/** 活动面板的计划页：批准后审批面板收起，计划仍需要一个随时能回看的位置。 */
export function PlanTabPanel(): JSX.Element | null {
	const model = usePlanTabPanelModel();
	if (!model.plan) return null;
	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
				<span aria-hidden className="icon-[solar--checklist-minimalistic-linear] h-4 w-4 shrink-0 text-primary" />
				<h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{model.headline}</h2>
				<PlanStatusBadge tone={model.plan.tone} label={model.plan.statusLabel} />
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
				<RendererMarkdownContent text={model.plan.content} className="text-[13px]" />
			</div>
		</div>
	);
}
