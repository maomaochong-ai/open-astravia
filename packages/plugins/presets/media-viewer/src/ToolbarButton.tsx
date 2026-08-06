import { Button, cn } from "@vetta/ui";
import type { JSX } from "react";

interface ToolbarButtonProps {
	/** Text label (used when `icon` is not set). */
	label?: string;
	/** Iconify class, e.g. `icon-[mdi--magnify-plus-outline]`. */
	icon?: string;
	onClick: () => void;
	disabled?: boolean;
	title?: string;
}

export function ToolbarButton({ label, icon, onClick, disabled, title }: ToolbarButtonProps): JSX.Element {
	return (
		<Button
			type="button"
			variant="ghost"
			size={icon && !label ? "icon-sm" : "sm"}
			onClick={onClick}
			disabled={disabled}
			title={title}
			className="rounded-full"
		>
			{icon ? <span className={cn(icon, "h-4 w-4")} aria-hidden /> : label}
		</Button>
	);
}
