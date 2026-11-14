import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
import { AnimatePresence, motion } from "motion/react";
import type { JSX, ReactNode } from "react";
import { useThemeComponent } from "@astravia-org/theme-sdk";
import type { PageHeaderContentProps as SdkPageHeaderContentProps } from "@astravia-org/theme-sdk/app-shell";
import { cn } from "@astravia-org/ui/utils";
import { PageHeaderSidebarTrigger } from "./PageHeaderSidebarTrigger";
import { PageHeaderTitle } from "./PageHeaderTitle";
import { PageHeaderWindowActions } from "./PageHeaderWindowActions";

export interface PageHeaderContentProps extends SdkPageHeaderContentProps {
	/** Host-provided window chrome (connected WindowControls). */
	windowControls?: ReactNode;
}

export function PageHeaderContent({
	actions,
	classNames,
	model,
	narrow,
	windowControls,
}: PageHeaderContentProps): JSX.Element {
	const ThemeSidebarTrigger = useThemeComponent("app.pageHeaderSidebarTrigger", PageHeaderSidebarTrigger);
	const ThemePageHeaderTitle = useThemeComponent("app.pageHeaderTitle", PageHeaderTitle);
	const ThemePageHeaderWindowActions = useThemeComponent(
		"app.pageHeaderWindowActions",
		PageHeaderWindowActions,
	);

	return (
		<>
			<div className={cn("no-drag flex min-w-0 items-center gap-2", classNames?.left)}>
				<AnimatePresence initial={false}>
					{model.triggerVisible && model.leftActions ? (
						/*
						 * 触发器与动作合成一个按钮组（会话页：展开侧边栏 + 新会话）。
						 * 两者都在「侧边栏不可见」时才出现，所以并进同一颗胶囊比并排两个
						 * 独立按钮更省空间，也少一次视觉跳动。
						 */
						<motion.div
							key="expand-group"
							initial={{ opacity: 0, scale: 0.9 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.9 }}
							transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
							className="shrink-0"
						>
							<ButtonGroup>
								<ButtonGroupItem
									title={model.sidebarTriggerTitle}
									aria-label={model.sidebarTriggerTitle}
									onClick={narrow ? actions.onOverlayOpen : actions.onExpandSidebar}
									onMouseEnter={narrow ? actions.onOverlayOpen : undefined}
									onMouseLeave={narrow ? actions.onOverlayClose : undefined}
									icon={<span className="icon-[solar--sidebar-minimalistic-linear] h-4 w-4" />}
								/>
								{model.leftActions}
							</ButtonGroup>
						</motion.div>
					) : model.triggerVisible ? (
						<motion.div
							key="expand"
							initial={{ opacity: 0, scale: 0.85, width: 0 }}
							animate={{ opacity: 1, scale: 1, width: 28 }}
							exit={{ opacity: 0, scale: 0.85, width: 0 }}
							transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
							className="shrink-0 overflow-hidden"
						>
							<ThemeSidebarTrigger
								title={model.sidebarTriggerTitle}
								// 纯图标按钮只靠 title 时屏幕阅读器读不到，补可访问名（组内那条已由 ButtonGroupItem 提供）。
								aria-label={model.sidebarTriggerTitle}
								onClick={narrow ? actions.onOverlayOpen : actions.onExpandSidebar}
								onMouseEnter={narrow ? actions.onOverlayOpen : undefined}
								onMouseLeave={narrow ? actions.onOverlayClose : undefined}
								className={classNames?.sidebarTrigger}
							/>
						</motion.div>
					) : null}
				</AnimatePresence>
				{model.leftSlot}
				{!model.titleHidden && <ThemePageHeaderTitle title={model.title} className={classNames?.title} />}
				{typeof model.titleBadge === "string" ? (
					<span
						className="max-w-[min(40vw,22rem)] truncate text-[11px] font-normal text-muted-foreground/55"
						title={model.titleBadge}
					>
						{model.titleBadge}
					</span>
				) : (
					model.titleBadge
				)}
			</div>
			<ThemePageHeaderWindowActions className={classNames?.actions} trailing={windowControls}>
				{model.utilitySlot}
				{model.rightSlot}
			</ThemePageHeaderWindowActions>
		</>
	);
}
