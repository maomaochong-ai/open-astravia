import { useTranslation } from "@vetta-org/plugin-sdk";

interface AskVettaButtonProps {
	/** 0 = no selection: the ask targets the whole design. */
	selectedCount: number;
	/** True while the user is drilled into one element. */
	elementMode: boolean;
	active: boolean;
	onClick(): void;
}

/**
 * The canvas's primary action, floating just above the control bar. It is the
 * plugin's core entry point, so it stays visible even with nothing selected
 * (then it targets the whole design) and carries a soft pulsing halo.
 */
export function AskVettaButton({ selectedCount, elementMode, active, onClick }: AskVettaButtonProps) {
	const { t } = useTranslation();
	const label = elementMode
		? t("canvas.ask.button.element")
		: selectedCount > 1
			? t("canvas.ask.button.frames", { count: selectedCount })
			: selectedCount === 1
				? t("canvas.ask.button.frame")
				: t("canvas.ask.button.design");

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: swallow canvas gestures under the button
		<div
			className="pointer-events-auto absolute bottom-16 left-1/2 z-20 -translate-x-1/2"
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				onClick={onClick}
				aria-pressed={active}
				className={`vetd-ask-glow relative flex items-center rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 ${
					active ? "scale-105" : ""
				}`}
			>
				{/* 抬到光波层之上，否则扫光会从文字上糊过去 */}
				<span className="relative z-10 flex items-center gap-1.5">
					<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
						<path
							d="M12 3l1.9 4.9L19 9.8l-4.1 2.3L14 17l-2-3.6L8 17l1.1-4.9L5 9.8l5.1-1.9L12 3z"
							strokeLinejoin="round"
						/>
					</svg>
					{label}
				</span>
			</button>
		</div>
	);
}
