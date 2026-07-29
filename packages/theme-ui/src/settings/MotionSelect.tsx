import { useState, type JSX, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";

/**
 * 设置页 motion 下拉（对齐原 Agent 人设）。
 *
 * 不用 Radix Select 的条件 Content：SelectValue 依赖已挂载 Item 把文案 portal
 * 到触发器，Content 关闭卸载后触发器会空白。本组件用 Popover + 显式 label。
 *
 * 视觉与 `@vetta/ui` Select 默认皮一致。
 */

const itemVariants = {
	hidden: { opacity: 0, x: -12 },
	show: { opacity: 1, x: 0 },
};

export interface MotionSelectOption {
	readonly value: string;
	readonly label: ReactNode;
	readonly disabled?: boolean;
	/** 禁用时 title / 提示 */
	readonly title?: string;
}

export interface MotionSelectProps {
	readonly value: string;
	readonly onValueChange: (value: string) => void;
	readonly options: readonly MotionSelectOption[];
	readonly placeholder?: string;
	readonly disabled?: boolean;
	/** 触发器额外 class（宽高等） */
	readonly triggerClassName?: string;
	readonly "aria-label"?: string;
}

export function MotionSelect({
	value,
	onValueChange,
	options,
	placeholder,
	disabled,
	triggerClassName,
	"aria-label": ariaLabel,
}: MotionSelectProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const selected = options.find((option) => option.value === value);
	const display = selected?.label ?? placeholder ?? "";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={ariaLabel}
					disabled={disabled}
					className={cn(
						// 与 @vetta/ui SelectTrigger 同皮
						"flex h-8 w-fit items-center justify-between gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors outline-none",
						"hover:bg-accent data-[state=open]:bg-accent",
						"focus-visible:border-primary/50",
						"disabled:cursor-not-allowed disabled:opacity-50",
						!selected && placeholder ? "text-muted-foreground" : "text-foreground",
						triggerClassName,
					)}
				>
					<span className="min-w-0 flex-1 truncate text-left">{display}</span>
					<span className="icon-[mdi--chevron-down] ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<AnimatePresence>
				{open ? (
					<PopoverContent
						forceMount
						asChild
						align="start"
						sideOffset={6}
						// asChild 时 className 会合并到 motion.div：背景/边框必须写在这里，
						// 勿用 bg-transparent（会盖掉 bg-popover，面板变「没背景」）
						className={cn(
							"z-50 w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)]",
							"gap-0 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-hidden",
							"data-open:animate-none data-closed:animate-none",
						)}
						style={{ animation: "none" }}
					>
						<motion.div
							initial={{ opacity: 0, scale: 0.96, y: -8 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							exit={{ opacity: 0, scale: 0.96, y: -8 }}
							transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
						>
							<motion.div
								variants={{
									hidden: {},
									show: { transition: { staggerChildren: 0.025, delayChildren: 0.02 } },
								}}
								initial="hidden"
								animate="show"
							>
								{options.map((option) => {
									const isSelected = option.value === value;
									return (
										<motion.div key={option.value} variants={itemVariants}>
											<button
												type="button"
												disabled={option.disabled}
												title={option.title}
												onClick={() => {
													if (option.disabled) return;
													setOpen(false);
													onValueChange(option.value);
												}}
												className={cn(
													// 与 @vetta/ui SelectItem / 原 Agent 菜单项同皮
													"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium transition-colors outline-none",
													"disabled:pointer-events-none disabled:opacity-50",
													isSelected
														? "bg-accent text-foreground"
														: "text-foreground hover:bg-accent",
												)}
											>
												<span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
												{isSelected ? (
													<span className="icon-[mdi--check] ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
												) : null}
											</button>
										</motion.div>
									);
								})}
							</motion.div>
						</motion.div>
					</PopoverContent>
				) : null}
			</AnimatePresence>
		</Popover>
	);
}
