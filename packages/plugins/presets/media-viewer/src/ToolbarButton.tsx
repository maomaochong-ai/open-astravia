import type { JSX } from "react";
import { cn } from "./utils";

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
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={cn(
				"flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[12px] text-[var(--foreground)] transition-colors",
				"hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40",
			)}
		>
			{icon ? <span className={cn(icon, "h-4 w-4")} aria-hidden /> : label}
		</button>
	);
}
