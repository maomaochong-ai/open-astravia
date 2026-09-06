import type { JSX } from "react";
import { cn } from "@astravia/ui";
import { getDatabaseTypeMeta } from "../lib/database-type-catalog";

export function DatabaseTypeBadge({
	type,
	className,
	size = "md",
}: {
	type: string;
	className?: string;
	size?: "sm" | "md" | "lg";
}): JSX.Element {
	const meta = getDatabaseTypeMeta(type);
	return (
		<span
			className={cn(
				"flex shrink-0 select-none items-center justify-center rounded-[10px] font-bold shadow-sm",
				size === "sm" && "h-7 w-7 rounded-lg text-[10px]",
				size === "md" && "h-9 w-9 text-[11px]",
				size === "lg" && "h-12 w-12 rounded-xl text-[13px]",
				className,
			)}
			style={{ backgroundColor: meta.color, color: meta.badge === "DU" ? "#1e293b" : "#ffffff" }}
			title={meta.label}
		>
			{meta.badge}
		</span>
	);
}
