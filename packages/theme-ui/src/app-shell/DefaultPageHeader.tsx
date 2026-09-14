import type { JSX, ReactNode } from "react";
import { useThemeComponent } from "@vetta-org/theme-sdk";
import type { PageHeaderRegionProps } from "@vetta-org/theme-sdk/app-shell";
import { PageHeaderContent } from "./PageHeaderContent";
import { PageHeaderFrame } from "./PageHeaderFrame";

export interface DefaultPageHeaderProps extends PageHeaderRegionProps {
	/**
	 * Force Mac titlebar metrics (traffic-light gutter / h-11).
	 * Use for marketing shells that paint Mac chrome on any host OS.
	 */
	forceMacChrome?: boolean;
	/** Host-provided window chrome (connected WindowControls). */
	windowControls?: ReactNode;
}

export function DefaultPageHeader({
	className,
	classNames,
	forceMacChrome = false,
	model,
	narrow,
	onExpandSidebar,
	onOverlayClose,
	onOverlayOpen,
	windowControls,
}: DefaultPageHeaderProps): JSX.Element {
	const ThemePageHeaderContent = useThemeComponent("app.pageHeaderContent", PageHeaderContent);

	return (
		<PageHeaderFrame
			className={className}
			contentClassName={classNames?.content}
			forceMacChrome={forceMacChrome}
			triggerVisible={model.triggerVisible}
		>
			<ThemePageHeaderContent
				actions={{ onExpandSidebar, onOverlayClose, onOverlayOpen }}
				classNames={classNames}
				model={model}
				narrow={narrow}
				windowControls={windowControls}
			/>
		</PageHeaderFrame>
	);
}
