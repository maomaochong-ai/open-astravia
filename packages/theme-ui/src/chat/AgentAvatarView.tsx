import { cn } from "@vetta/ui";
import type { JSX } from "react";

export interface AgentAvatarViewProps {
	readonly name: string;
	readonly avatar?: string;
	readonly blueprintId?: string;
	readonly active?: boolean;
	readonly size?: "xs" | "sm" | "md";
	readonly className?: string;
}

const SIZE_CLASS = {
	xs: "h-4 w-4 text-[10px]",
	sm: "h-7 w-7 text-[11px]",
	md: "h-9 w-9 text-[13px]",
} as const;

export function AgentAvatarView({
	name,
	avatar,
	blueprintId = "leader",
	active = false,
	size = "sm",
	className,
}: AgentAvatarViewProps): JSX.Element {
	const sizeClass = SIZE_CLASS[size];
	if (avatar) {
		return (
			<img
				src={avatar}
				alt=""
				className={cn(
					"shrink-0 rounded-full object-cover ring-1 ring-border",
					active && "ring-primary/60",
					sizeClass,
					className,
				)}
			/>
		);
	}
	const initial = Array.from(name.trim())[0]?.toLocaleUpperCase();
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary ring-1 ring-border",
				active && "ring-primary/60",
				sizeClass,
				className,
			)}
		>
			{initial || <span className={cn(blueprintIcon(blueprintId), "h-1/2 w-1/2")} />}
		</span>
	);
}

function blueprintIcon(blueprintId: string): string {
	if (blueprintId === "researcher") return "icon-[solar--magnifer-linear]";
	if (blueprintId === "builder") return "icon-[solar--code-square-linear]";
	if (blueprintId === "reviewer") return "icon-[solar--shield-check-linear]";
	return "icon-[solar--crown-star-linear]";
}
