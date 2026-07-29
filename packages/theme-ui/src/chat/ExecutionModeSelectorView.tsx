import { AnimatePresence, motion } from "motion/react";
import type { JSX } from "react";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@vetta/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface ExecutionModeOptionView {
	readonly mode: string;
	readonly icon: string;
	readonly label: string;
	readonly title: string;
	readonly disabled: boolean;
	readonly selected: boolean;
}

export interface ExecutionModeSelectorViewProps {
	readonly open: boolean;
	readonly disabled: boolean;
	readonly selectedOption: ExecutionModeOptionView;
	readonly options: readonly ExecutionModeOptionView[];
	readonly className?: string;
	readonly classNames?: {
		readonly root?: string;
		readonly trigger?: string;
		readonly content?: string;
		readonly contentInner?: string;
		readonly item?: string;
	};
	readonly onOpenChange: (open: boolean) => void;
	readonly onSelect: (mode: string) => void;
}

export function ExecutionModeSelectorView({
	open,
	disabled,
	selectedOption,
	options,
	className,
	classNames,
	onOpenChange,
	onSelect,
}: ExecutionModeSelectorViewProps): JSX.Element {
	return (
		<div className={cn("ml-1 min-w-0", className, classNames?.root)}>
			<Popover open={open} onOpenChange={disabled ? undefined : onOpenChange}>
				<PopoverTrigger asChild>
					<button
						type="button"
						disabled={disabled}
						title={selectedOption.title}
						className={cn(
							"no-drag flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
							open
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
							classNames?.trigger,
						)}
					>
						<span className={cn(selectedOption.icon, "h-3.5 w-3.5 shrink-0")} />
						<span className="truncate">{selectedOption.label}</span>
					</button>
				</PopoverTrigger>
				<AnimatePresence>
					{open && (
						<PopoverContent
							forceMount
							asChild
							side="top"
							align="start"
							sideOffset={6}
							className={cn(
								"w-[148px] gap-0 overflow-visible rounded-lg border border-border p-0",
								classNames?.content,
							)}
							style={{ animation: "none" }}
						>
							<motion.div
								initial={{ opacity: 0, scale: 0.96, y: 8 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.96, y: 8 }}
								transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
								className="relative overflow-visible rounded-[inherit]"
							>
								<ThemeSurface slot="chat.executionModeMenu" />
								<div
									className={cn(
										"relative z-10 overflow-hidden rounded-[inherit] p-1",
										classNames?.contentInner,
									)}
								>
									{options.map((option) => (
										<button
											key={option.mode}
											type="button"
											title={option.title}
											disabled={option.disabled}
											onClick={() => {
												onOpenChange(false);
												onSelect(option.mode);
											}}
											className={cn(
												"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
												option.selected
													? "bg-accent text-foreground"
													: "text-foreground hover:bg-accent",
												classNames?.item,
											)}
										>
											<span className={cn(option.icon, "h-3.5 w-3.5 shrink-0")} />
											<span className="truncate">{option.label}</span>
											{option.selected && (
												<span className="icon-[solar--check-circle-linear] ml-auto h-3.5 w-3.5 text-primary" />
											)}
										</button>
									))}
								</div>
							</motion.div>
						</PopoverContent>
					)}
				</AnimatePresence>
			</Popover>
		</div>
	);
}
