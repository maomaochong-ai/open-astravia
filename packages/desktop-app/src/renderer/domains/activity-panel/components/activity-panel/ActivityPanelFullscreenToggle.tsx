import { activityPanelFullscreenAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";

/**
 * 全屏图标：参考 iconfont「全屏」设计（圆角方框 + 四角实心三角形）。
 * exit=false 时上两角 ▲ 朝上、下两角 ▼ 朝下（展开）；exit=true 时四角三角形均指向中心（收缩）。
 */
function FullscreenGlyph({ exit, className }: { readonly exit: boolean; readonly className?: string }): JSX.Element {
	return (
		<svg viewBox="0 0 24 24" className={className} aria-hidden="true">
			<rect
				x={2}
				y={2}
				width={20}
				height={20}
				rx={2}
				fill="none"
				stroke="currentColor"
				strokeWidth={1.7}
			/>
			<path
				d={
					exit
						? "M9.5,9.5 L9.5,6.1 L6.1,6.1 Z M14.5,9.5 L14.5,6.1 L17.9,6.1 Z M9.5,14.5 L9.5,17.9 L6.1,17.9 Z M14.5,14.5 L14.5,17.9 L17.9,17.9 Z"
						: "M9.5,6.1 L9.5,9.5 L6.1,9.5 Z M14.5,6.1 L14.5,9.5 L17.9,9.5 Z M9.5,17.9 L9.5,14.5 L6.1,14.5 Z M14.5,17.9 L14.5,14.5 L17.9,14.5 Z"
				}
				fill="currentColor"
			/>
		</svg>
	);
}

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
			<FullscreenGlyph exit={fullscreen} className="h-4 w-4" />
		</button>
	);
}
