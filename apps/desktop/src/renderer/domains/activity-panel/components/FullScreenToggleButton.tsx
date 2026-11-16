import { useTranslation } from "react-i18next";

export interface FullScreenToggleButtonProps {
	/** 活动面板是否已经铺满内容区。 */
	isFullScreen: boolean;
	onToggle: () => void;
	className?: string;
}

/**
 * 活动标签栏的全屏切换按钮（位于标签菜单左侧）。
 * 放大的是当前激活面板这一列，不是宿主窗口；图标与文案都跟随面板状态。
 */
export function FullScreenToggleButton({
	isFullScreen,
	onToggle,
	className,
}: FullScreenToggleButtonProps): JSX.Element {
	const { t } = useTranslation("project");
	const label = isFullScreen ? t("tabPicker.exitFullScreen") : t("tabPicker.enterFullScreen");

	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={isFullScreen}
			onClick={onToggle}
			className={[
				// h-8 与 TabBar 的标签同高、去掉 mb-0.5：否则在 Header 的 items-end 布局里，
				// 按钮底部比标签底高 2px，图标与标签不在同一水平线上。
				"mr-1 flex h-8 min-w-7 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
				className ?? "",
			].join(" ")}
		>
			<span
				className={
					isFullScreen
						? "icon-[solar--minimize-square-linear] h-4 w-4"
						: "icon-[solar--maximize-square-linear] h-4 w-4"
				}
			/>
		</button>
	);
}
