import { MotionSelect } from "@astravia-org/theme-ui/settings";
import { cn } from "@astravia-org/ui/utils";
import type { ReactNode } from "react";

/** 分组卡片：与设置页 SettingSection 同款——组标题 + 圆角卡片，卡片内的行以细线分隔。 */
export function FieldGroup({ title, children }: { readonly title?: string; readonly children: ReactNode }): JSX.Element {
	return (
		<section>
			{title ? <h2 className="mb-3 text-[15px] font-semibold text-foreground">{title}</h2> : null}
			<div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{children}</div>
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
		<div className={cn("px-4 py-2.5", stacked ? "space-y-2" : "flex items-center justify-between gap-6")}>
			<div className={cn("min-w-0", !stacked && "flex-1")}>
				<div className="truncate text-[13px] font-medium text-foreground">{label}</div>
				{hint ? <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div> : null}
			</div>
			<div className={cn("min-w-0", stacked ? "w-full" : "flex shrink-0 justify-end")}>{children}</div>
		</div>
	);
}

/** 行尾的下拉选择：设置页同款 MotionSelect（空串映射由它自己处理）。 */
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
	return (
		<MotionSelect
			aria-label={ariaLabel}
			options={options}
			value={value}
			disabled={disabled}
			onValueChange={onChange}
			triggerClassName="max-w-[260px]"
		/>
	);
}

export const rowInputClass =
	"h-7 rounded-md border border-border/50 bg-background/60 px-2 text-[12px] text-foreground focus:outline-none [color-scheme:light_dark]";

export function chipClass(selected: boolean): string {
	return cn(
		"flex h-7 min-w-7 items-center justify-center whitespace-nowrap rounded-md px-1.5 text-[12px] tabular-nums transition-colors",
		selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
	);
}
