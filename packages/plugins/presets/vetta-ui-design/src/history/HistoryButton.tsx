/**
 * 画布右上角的历史开关。
 *
 * 不放进 ControlBar：那一排是「用什么工具画」（选择、拖手、画框、备注、缩放），
 * 翻历史不是一种画布工具，混进去还会让本来就长的 dock 再长一截。
 */
import { useTranslation } from "@vetta-org/plugin-sdk";

interface HistoryButtonProps {
	open: boolean;
	/** 查看模式的横幅压在画布顶部，按钮要给它让位。 */
	offsetTop: number;
	onToggle(): void;
}

export function HistoryButton({ open, offsetTop, onToggle }: HistoryButtonProps) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			title={t("controlbar.history")}
			aria-label={t("controlbar.history")}
			aria-pressed={open}
			onClick={onToggle}
			// 同历史抽屉：不截断的话画布根会捕获指针，按钮点不动。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			style={{ top: 12 + offsetTop }}
			className={`pointer-events-auto absolute right-3 z-40 flex size-8 items-center justify-center rounded-lg border shadow-sm backdrop-blur-xl transition-colors ${
				open
					? "border-primary/40 bg-primary/10 text-primary"
					: "border-border/60 bg-popover/90 text-muted-foreground hover:text-foreground"
			}`}
		>
			<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
				<path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</button>
	);
}
