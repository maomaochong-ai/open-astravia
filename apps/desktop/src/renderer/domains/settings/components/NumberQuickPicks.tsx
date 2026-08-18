import { cn } from "@shared/lib/utils";

export interface QuickPick {
	label: string;
	value: number;
}

/** 常用上下文窗口（tokens） */
export const CONTEXT_WINDOW_PICKS: QuickPick[] = [
	{ label: "32K", value: 32768 },
	{ label: "64K", value: 65536 },
	{ label: "128K", value: 131072 },
	{ label: "256K", value: 262144 },
	{ label: "1M", value: 1048576 },
];

/** 常用最大输出（tokens） */
export const MAX_OUTPUT_PICKS: QuickPick[] = [
	{ label: "16K", value: 16384 },
	{ label: "32K", value: 32768 },
	{ label: "64K", value: 65536 },
	{ label: "128K", value: 131072 },
	{ label: "384K", value: 393216 },
];

/** 一排可点的快捷数值标签——点了就把对应输入框设成该值。 */
export function NumberQuickPicks({
	picks,
	current,
	onPick,
	className,
}: {
	picks: QuickPick[];
	current?: string;
	onPick: (value: string) => void;
	className?: string;
}): JSX.Element {
	return (
		<div className={cn("mt-1 flex flex-wrap gap-1", className)}>
			{picks.map((pick) => {
				const active = current?.trim() === String(pick.value);
				return (
					<button
						key={pick.value}
						type="button"
						onClick={() => onPick(String(pick.value))}
						className={cn(
							"rounded-md border px-1.5 py-0.5 text-[11px] transition-colors",
							active
								? "border-primary bg-primary/10 text-primary"
								: "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
						)}
					>
						{pick.label}
					</button>
				);
			})}
		</div>
	);
}
