import { Fragment, useState, type JSX } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import { cn } from "@vetta/ui";

export interface SidebarFilterSelectOption {
	readonly value: string;
	readonly label: string;
	/** 有值时在标签前画一个该色的 Dot——标签档靠颜色辨认。 */
	readonly dotColor?: string;
	/** 在该项之前插一条分割线，用于隔开来源档与标签档。 */
	readonly separatorBefore?: boolean;
}

export interface SidebarFilterSelectViewProps {
	readonly options: readonly SidebarFilterSelectOption[];
	readonly showGridIcon?: boolean;
	readonly value: string;
	readonly onChange: (value: string) => void;
}

export function SidebarFilterSelectView({
	options,
	showGridIcon = false,
	value,
	onChange,
}: SidebarFilterSelectViewProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const current = options.find((option) => option.value === value) ?? options[0];

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						// 与侧栏「更多」触发器对齐：icon h-4 + gap-2。
						"no-drag flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 text-[12px] font-medium transition-colors",
						open
							? "bg-accent text-foreground"
							: "text-muted-foreground/80 hover:bg-accent hover:text-foreground",
					)}
				>
					{showGridIcon && <span className="icon-[solar--widget-4-linear] h-4 w-4 shrink-0" />}
					{/* 选中标签档时把颜色带到收起态，否则收起后只剩一个名字，认不出是哪个标签。 */}
					{current?.dotColor ? (
						<span
							aria-hidden="true"
							className="h-2.5 w-2.5 shrink-0 rounded-full"
							style={{ backgroundColor: current.dotColor }}
						/>
					) : null}
					<span className="truncate">{current?.label ?? ""}</span>
					<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3 shrink-0" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="bottom"
				align="start"
				sideOffset={4}
				className="max-h-[60vh] w-[160px] gap-0 overflow-y-auto rounded-lg border border-border p-1"
			>
				{options.map((option) => (
					<Fragment key={option.value}>
						{option.separatorBefore ? <div className="-mx-1 my-1 h-px bg-border" /> : null}
						<button
							type="button"
							onClick={() => {
								onChange(option.value);
								setOpen(false);
							}}
							className={cn(
								"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium transition-colors",
								value === option.value
									? "bg-primary text-primary-foreground"
									: "text-foreground hover:bg-accent",
							)}
						>
							{option.dotColor ? (
								<span
									aria-hidden="true"
									className="h-2.5 w-2.5 shrink-0 rounded-full"
									style={{ backgroundColor: option.dotColor }}
								/>
							) : null}
							<span className="truncate">{option.label}</span>
							{value === option.value && (
								<span className="icon-[solar--check-circle-linear] ml-auto h-3.5 w-3.5 shrink-0" />
							)}
						</button>
					</Fragment>
				))}
			</PopoverContent>
		</Popover>
	);
}
