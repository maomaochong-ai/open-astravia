import { cn } from "@vetta-org/ui";
import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";

export interface InputBarBackgroundProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	children?: ReactNode;
}

export function InputBarBackground({
	children,
	className,
	...props
}: InputBarBackgroundProps): JSX.Element {
	return (
		<div
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute inset-0 z-[1] overflow-hidden rounded-[inherit]",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}
