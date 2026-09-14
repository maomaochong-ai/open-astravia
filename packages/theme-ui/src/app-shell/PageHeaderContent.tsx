import { AnimatePresence, motion } from "motion/react";
import type { JSX, ReactNode } from "react";
import { useThemeComponent } from "@vetta-org/theme-sdk";
import type { PageHeaderContentProps as SdkPageHeaderContentProps } from "@vetta-org/theme-sdk/app-shell";
import { cn } from "@vetta-org/ui";
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
					{model.triggerVisible && (
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
								onClick={narrow ? actions.onOverlayOpen : actions.onExpandSidebar}
								onMouseEnter={narrow ? actions.onOverlayOpen : undefined}
								onMouseLeave={narrow ? actions.onOverlayClose : undefined}
								className={classNames?.sidebarTrigger}
							/>
						</motion.div>
					)}
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
				{model.rightSlot}
			</ThemePageHeaderWindowActions>
		</>
	);
}
