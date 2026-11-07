import { useTranslation } from "react-i18next";
import { useFullScreenToggle } from "../hooks/useFullScreenToggle";

export interface FullScreenToggleButtonProps {
	className?: string;
}

/**
 * 宿主标签栏右侧的全屏切换按钮（紧邻标签菜单）。
 * 样式与标签菜单触发器一致，保证两条按钮在同一行里视觉等高。
 */
export function FullScreenToggleButton({ className }: FullScreenToggleButtonProps): JSX.Element {
	const { t } = useTranslation("project");
	const { isFullScreen, toggle } = useFullScreenToggle();
	const label = isFullScreen ? t("tabPicker.exitFullScreen") : t("tabPicker.enterFullScreen");

	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={isFullScreen}
			onClick={toggle}
			className={[
				"mb-0.5 flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
				className ?? "",
			].join(" ")}
		>
			<span
				className={
					isFullScreen
						? "icon-[solar--minimize-square-3-linear] h-4 w-4"
						: "icon-[solar--maximize-square-3-linear] h-4 w-4"
				}
			/>
		</button>
	);
}
