import { ArrowUpCircle, X } from "lucide-react";
import { useSidebarUpdateBannerModel } from "./useSidebarUpdateBannerModel";

/** 侧栏底部更新条：宽度跟随侧栏（由外层内边距决定），右侧按钮立即重启安装，悬浮时左侧图标变为忽略按钮。 */
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
				<ArrowUpCircle className="absolute inset-0 size-4 text-primary group-hover:hidden" />
				<X className="absolute inset-0 hidden size-4 group-hover:block" />
			</button>
			<span className="min-w-0 flex-1 truncate text-foreground text-xs">{model.label}</span>
			<button
				type="button"
				onClick={model.onRestart}
				className="shrink-0 rounded bg-primary px-2 py-0.5 text-primary-foreground text-xs transition-opacity hover:opacity-90"
			>
				{model.restartLabel}
			</button>
		</div>
	);
}
