import { ArrowUpCircle, Download, RotateCcw, X } from "lucide-react";
import { useSidebarUpdateBannerModel } from "./useSidebarUpdateBannerModel";

/**
 * 侧栏底部更新条：
 *   available 阶段 → 「新版本 X 可用」+ 下载按钮
 *   ready 阶段     → 「新版本 X 已就绪」+ 立即重启按钮
 * 忽略按钮：hover 时把左侧图标换成 X，点击后按版本记忆隐藏。
 */
export function SidebarUpdateBanner(): JSX.Element | null {
	const model = useSidebarUpdateBannerModel();

	if (!model) return null;

	return (
		<div className="group flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-white px-2 py-1.5 dark:bg-card">
			<button
				type="button"
				onClick={model.onDismiss}
				title={model.dismissLabel}
				aria-label={model.dismissLabel}
				className="relative size-4 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
			>
				{model.stage === "available" ? (
					<Download className="absolute inset-0 size-4 text-primary group-hover:hidden" />
				) : (
					<ArrowUpCircle className="absolute inset-0 size-4 text-primary group-hover:hidden" />
				)}
				<X className="absolute inset-0 hidden size-4 group-hover:block" />
			</button>
			<span className="min-w-0 flex-1 truncate text-foreground text-xs">{model.label}</span>
			<button
				type="button"
				onClick={model.onAction}
				className="shrink-0 rounded bg-primary px-2 py-0.5 text-primary-foreground text-xs transition-opacity hover:opacity-90"
			>
				{model.stage === "available" ? (
					<span className="inline-flex items-center gap-1">
						<Download className="size-3" />
						{model.actionLabel}
					</span>
				) : (
					<span className="inline-flex items-center gap-1">
						<RotateCcw className="size-3" />
						{model.actionLabel}
					</span>
				)}
			</button>
		</div>
	);
}
