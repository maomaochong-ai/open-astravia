import { forwardRef, type JSX } from "react";
import type { WindowControlButtonProps, WindowControlKind } from "@vetta-org/theme-sdk/app-shell";
import { cn } from "@vetta-org/ui";

const WINDOW_CONTROL_ICONS: Record<WindowControlKind, string> = {
	close: "icon-[mdi--close]",
	maximize: "icon-[mdi--window-maximize]",
	minimize: "icon-[mdi--window-minimize]",
	restore: "icon-[mdi--window-restore]",
};

export const WindowControlButton = forwardRef<HTMLButtonElement, WindowControlButtonProps>(
	function WindowControlButton({ className, control, iconClassName, onClick, ...props }, ref): JSX.Element {
		return (
			<button
				ref={ref}
				type="button"
				onClick={(event) => {
					onClick?.(event);
					if (!event.defaultPrevented) control.action();
				}}
				title={control.label}
				aria-label={control.label}
				className={cn(
					"flex h-8 w-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent/50 active:opacity-70",
					control.kind === "close" && "hover:bg-destructive hover:text-destructive-foreground",
					className,
				)}
				{...props}
			>
				<span className={cn(WINDOW_CONTROL_ICONS[control.kind], "h-4 w-4", iconClassName)} />
			</button>
		);
	},
);
