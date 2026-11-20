import { useEffect, useState } from "react";
import { formatUiZoomPercent, UI_ZOOM_STEPS, uiZoomStepIndex } from "../../../shared/ui-zoom";

const HUD_VISIBLE_MS = 1200;

/**
 * 快捷键缩放时在右上角短暂提示当前档位。只响应快捷键（主进程单独的通道），
 * 设置页滑块拖动自带数值显示，不重复弹。
 */
export function UiZoomHud(): JSX.Element {
	const [factor, setFactor] = useState<number | null>(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const off = window.astravia.uiZoom.onShortcutZoom((value) => {
			setFactor(value);
			setVisible(true);
			clearTimeout(timer);
			timer = setTimeout(() => setVisible(false), HUD_VISIBLE_MS);
		});
		return () => {
			clearTimeout(timer);
			off();
		};
	}, []);

	if (factor === null) return <></>;
	const activeIndex = uiZoomStepIndex(factor);
	return (
		<div
			role="status"
			aria-live="polite"
			data-visible={visible}
			className="pointer-events-none fixed right-4 top-4 z-[200] flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-popover/95 px-4 py-2.5 text-popover-foreground shadow-lg backdrop-blur-xl transition-opacity duration-200 data-[visible=false]:opacity-0"
		>
			<span className="text-lg font-semibold tabular-nums leading-none">{formatUiZoomPercent(factor)}</span>
			<span className="flex items-center gap-1" aria-hidden="true">
				{UI_ZOOM_STEPS.map((step, index) => (
					<span
						key={step}
						className={`h-1 rounded-full transition-all ${index === activeIndex ? "w-4 bg-primary" : "w-1 bg-muted-foreground/40"}`}
					/>
				))}
			</span>
		</div>
	);
}
