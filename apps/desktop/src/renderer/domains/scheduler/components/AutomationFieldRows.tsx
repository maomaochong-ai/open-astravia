import { cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta-org/ui";
import type { ReactNode } from "react";

/** 分组卡片：组标题 + 圆角卡片，卡片内的行以细线分隔。 */
export function FieldGroup({ title, children }: { readonly title?: string; readonly children: ReactNode }): JSX.Element {
	return (
		<section className="space-y-2">
			{title ? <h3 className="px-1 text-[12px] text-muted-foreground">{title}</h3> : null}
			<div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card/40">{children}</div>
		</section>
	);
}

/**
 * 分组里的一行：左侧标签，右侧控件。stacked 时控件另起一行铺满（多选网格、文案输入）。
 */
export function FieldRow({
	label,
	hint,
	stacked = false,
	children,
}: {
	readonly label: string;
	readonly hint?: string;
	readonly stacked?: boolean;
	readonly children: ReactNode;
}): JSX.Element {
	return (
		<div className={cn("px-4 py-2.5", stacked ? "space-y-2" : "flex min-h-11 items-center gap-3")}>
			<div className={cn("min-w-0", !stacked && "flex-1")}>
				<div className="text-[13px] text-foreground">{label}</div>
				{hint ? <div className="mt-0.5 text-[11px] text-muted-foreground/70">{hint}</div> : null}
			</div>
			<div className={cn("min-w-0", stacked ? "w-full" : "flex shrink-0 justify-end")}>{children}</div>
		</div>
	);
}

/** 行尾的下拉选择；Radix Select 不接受空串取值，这里做一次映射。 */
export function RowSelect({
	ariaLabel,
	options,
	value,
	disabled,
	onChange,
}: {
	readonly ariaLabel: string;
	readonly options: readonly { readonly value: string; readonly label: string }[];
	readonly value: string;
	readonly disabled?: boolean;
	readonly onChange: (value: string) => void;
}): JSX.Element {
	const encode = (raw: string): string => (raw === "" ? "__empty__" : raw);
	const decode = (encoded: string): string => (encoded === "__empty__" ? "" : encoded);
	return (
		<Select value={encode(value)} onValueChange={(next) => onChange(decode(next))} disabled={disabled}>
			<SelectTrigger
				aria-label={ariaLabel}
				className="h-7 max-w-[260px] border-transparent bg-transparent px-2 text-muted-foreground hover:bg-accent"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end">
				{options.map((option) => (
					<SelectItem key={option.value} value={encode(option.value)}>
						<span className="block max-w-[320px] truncate">{option.label}</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export const rowInputClass =
	"h-7 rounded-md border border-border/50 bg-background/60 px-2 text-[12px] text-foreground focus:outline-none [color-scheme:light_dark]";

export function chipClass(selected: boolean): string {
	return cn(
		"flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] tabular-nums transition-colors",
		selected ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground hover:text-foreground",
	);
}
