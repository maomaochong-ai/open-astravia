import type { JSX } from "react";
import { useThemeComponent } from "@vetta-org/theme-sdk";
import type { WindowControlsComponentProps } from "@vetta-org/theme-sdk/app-shell";
import { cn } from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { WindowControlButton } from "./WindowControlButton";

export function DefaultWindowControls({ className, classNames, model }: WindowControlsComponentProps): JSX.Element | null {
	const ThemeWindowControlButton = useThemeComponent("app.windowControlButton", WindowControlButton);

	// macOS uses system traffic lights; do not reserve a 70px empty slot that
	// would squeeze PageHeader rightSlot (matches pre-migration host behavior).
	if (model.isMac) {
		return null;
	}

	return (
		<div className={cn("relative overflow-visible", className)} data-theme-surface-root="app.windowControls">
			<ThemeSurface slot="app.windowControls" />
			<div className="relative z-10 flex items-center gap-0.5">
				{model.controls.map((control) => (
					<ThemeWindowControlButton
						key={control.kind}
						control={control}
						className={cn(classNames?.button, control.kind === "close" && classNames?.closeButton)}
						iconClassName={classNames?.icon}
					/>
				))}
			</div>
		</div>
	);
}
