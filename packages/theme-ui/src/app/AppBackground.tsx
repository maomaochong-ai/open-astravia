import { cn } from "@vetta-org/ui";
import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { ThemeSurface } from "../appearance";

export interface AppBackgroundProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	children?: ReactNode;
}

export function AppBackground({
	children,
	className,
	...props
}: AppBackgroundProps): JSX.Element {
	return (
		<div
			aria-hidden="true"
			className={cn("pointer-events-none absolute inset-0 z-0 overflow-hidden", className)}
			{...props}
		>
			<ThemeSurface slot="app.frame" />
			{children}
		</div>
	);
}
