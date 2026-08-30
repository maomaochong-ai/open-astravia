import { activityPanelFullscreenAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";

/**
 * 活动面板 tab 菜单行内、「+」按钮左侧的全屏切换按钮：点击让当前 tab 覆盖整个窗口
 * （隐藏侧边栏与对话区），再次点击还原。样式与相邻的「+」按钮保持一致。
 */
export function ActivityPanelFullscreenToggle(): JSX.Element {
	const { t } = useTranslation("project");
	const [fullscreen, setFullscreen] = useAtom(activityPanelFullscreenAtom);

	return (
		<button
			type="button"
			title={fullscreen ? t("tabFullscreen.exit") : t("tabFullscreen.enter")}
			aria-label={fullscreen ? t("tabFullscreen.exit") : t("tabFullscreen.enter")}
			aria-pressed={fullscreen}
			onClick={() => setFullscreen((prev) => !prev)}
			className="mb-1 mr-1 flex h-5 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			<span
				className={
					fullscreen
						? "icon-[solar--quit-full-screen-linear] h-4 w-4"
						: "icon-[solar--full-screen-linear] h-4 w-4"
				}
			/>
		</button>
	);
}
