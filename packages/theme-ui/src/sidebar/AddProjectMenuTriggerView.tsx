import { Button } from "@astravia-org/ui/button";
import type { JSX } from "react";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface AddProjectMenuTriggerViewProps {
	label: string;
	onClick: () => void;
	open: boolean;
	variant: "icon" | "navItem" | "primary" | "secondary";
}

export function AddProjectMenuTriggerView({
	label,
	onClick,
	open,
	variant,
}: AddProjectMenuTriggerViewProps): JSX.Element {
	if (variant === "secondary") {
		return (
			<Button variant="secondary" size="lg" className="no-drag w-full text-[13px]" onClick={onClick}>
				<span className="icon-[solar--add-folder-linear] h-4 w-4 shrink-0" />
				{label}
			</Button>
		);
	}

	if (variant === "navItem") {
		return (
			<button
				type="button"
				title={label}
				onClick={onClick}
				className={cn(
					"no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
					open ? "bg-accent text-foreground" : "text-foreground hover:bg-accent",
				)}
			>
				<span className="icon-[solar--add-circle-linear] h-4 w-4 shrink-0" />
				{label}
			</button>
		);
	}

	return (
		<button
			type="button"
			title={label}
			onClick={onClick}
			className={cn(
				"flex items-center justify-center rounded-md p-1.5 text-foreground transition-opacity hover:bg-accent",
				open ? "opacity-100" : "opacity-0 group-hover:opacity-60 group-hover:hover:opacity-100",
			)}
		>
			<span className="icon-[solar--add-square-outline] h-4 w-4" />
		</button>
	);
}
