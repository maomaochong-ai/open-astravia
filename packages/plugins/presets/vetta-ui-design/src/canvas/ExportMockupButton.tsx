import { useTranslation } from "@vetta-org/plugin-sdk";
import { CanvasCornerButton } from "./CanvasCornerButton";

interface ExportMockupButtonProps {
	/** 查看模式的横幅压在画布顶部，按钮要给它让位。 */
	offsetTop: number;
	onOpen(): void;
}

/**
 * 画布右上角的「导出渲染图」，叠在历史按钮下面（见 CanvasCornerButton）。
 * 不要求先选中画框：画框在工作台里自己往渲染区加。
 */
export function ExportMockupButton({ offsetTop, onOpen }: ExportMockupButtonProps) {
	const { t } = useTranslation();
	return (
		<CanvasCornerButton
			label={t("controlbar.exportMockup.label")}
			active={false}
			top={52 + offsetTop}
			onClick={onOpen}
		>
			<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
				<path d="M12 3v12" strokeLinecap="round" />
				<path d="M8 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M4 14v4a3 3 0 003 3h10a3 3 0 003-3v-4" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</CanvasCornerButton>
	);
}
