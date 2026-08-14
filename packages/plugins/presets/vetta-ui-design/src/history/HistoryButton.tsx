import { useTranslation } from "@vetta-org/plugin-sdk";
import { CanvasCornerButton } from "../canvas/CanvasCornerButton";

interface HistoryButtonProps {
	open: boolean;
	/** 查看模式的横幅压在画布顶部，按钮要给它让位。 */
	offsetTop: number;
	onToggle(): void;
}

/** 画布右上角的历史开关，见 CanvasCornerButton。 */
export function HistoryButton({ open, offsetTop, onToggle }: HistoryButtonProps) {
	const { t } = useTranslation();
	return (
		<CanvasCornerButton label={t("controlbar.history")} active={open} top={12 + offsetTop} onClick={onToggle}>
			<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
				<path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</CanvasCornerButton>
	);
}
