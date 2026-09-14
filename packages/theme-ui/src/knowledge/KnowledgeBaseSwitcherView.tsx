import type { JSX, ReactNode } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from "@vetta-org/ui";

export interface KnowledgeBaseSwitcherItemView {
	readonly id: string;
	readonly name: string;
	readonly active: boolean;
	readonly isDefault: boolean;
	readonly fileCountLabel: string;
}

export interface KnowledgeBaseSwitcherViewLabels {
	readonly switchLabel: string;
	readonly renameCurrent: string;
	readonly deleteCurrent: string;
	readonly viewAll: string;
	readonly createBase: string;
}

export interface KnowledgeBaseSwitcherViewProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly activeName: string;
	readonly basesCount: number;
	readonly items: readonly KnowledgeBaseSwitcherItemView[];
	readonly showManageCurrent: boolean;
	readonly onSelect: (id: string) => void;
	readonly onStartRename: () => void;
	readonly onConfirmDelete: () => void;
	readonly onViewAll: () => void;
	readonly onCreate: () => void;
	readonly labels: KnowledgeBaseSwitcherViewLabels;
	/** Host owns rename dialog (may still use desktop KnowledgeRenameDialog adapter). */
	readonly renameDialog?: ReactNode;
}

export function KnowledgeBaseSwitcherView({
	open,
	onOpenChange,
	activeName,
	basesCount,
	items,
	showManageCurrent,
	onSelect,
	onStartRename,
	onConfirmDelete,
	onViewAll,
	onCreate,
	labels,
	renameDialog,
}: KnowledgeBaseSwitcherViewProps): JSX.Element {
	return (
		<>
			<Popover open={open} onOpenChange={onOpenChange}>
				<PopoverTrigger asChild>
					<button type="button" className="group flex max-w-full items-center gap-2 text-left">
						<h1 className="truncate text-[24px] font-bold tracking-tight text-foreground">
							{activeName}
						</h1>
						<span
							className={cn(
								"icon-[mdi--chevron-down] h-5 w-5 shrink-0 text-muted-foreground transition-transform",
								open && "rotate-180",
							)}
						/>
						{basesCount > 1 && (
							<span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
								{basesCount}
							</span>
						)}
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80 gap-1 p-1.5">
					<div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
						{labels.switchLabel}
					</div>
					{items.map((item) => (
						<Button
							key={item.id}
							type="button"
							variant="ghost"
							onClick={() => onSelect(item.id)}
							className={cn(
								"h-auto w-full justify-start gap-2.5 px-2 py-2 text-left",
								item.active ? "bg-primary/10" : "hover:bg-accent",
							)}
						>
							<span
								className={cn(
									"h-4 w-4 shrink-0",
									item.isDefault ? "icon-[mdi--account-circle-outline]" : "icon-[mdi--book-outline]",
									item.active ? "text-primary" : "text-muted-foreground",
								)}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-[12px] font-medium text-foreground">{item.name}</p>
								<p className="mt-0.5 text-[10px] text-muted-foreground/55">{item.fileCountLabel}</p>
							</div>
							{item.active && <span className="icon-[mdi--check] h-4 w-4 text-primary" />}
						</Button>
					))}

					<div className="my-1 h-px bg-border/60" />

					{showManageCurrent && (
						<>
							<Button
								type="button"
								variant="ghost"
								onClick={onStartRename}
								className="h-8 w-full justify-start gap-2 px-2 text-[12px] text-foreground"
							>
								<span className="icon-[mdi--rename-outline] h-4 w-4 text-muted-foreground" />
								{labels.renameCurrent}
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={onConfirmDelete}
								className="h-8 w-full justify-start gap-2 px-2 text-[12px] text-red-600 hover:bg-red-500/10 hover:text-red-600"
							>
								<span className="icon-[mdi--trash-can-outline] h-4 w-4" />
								{labels.deleteCurrent}
							</Button>
							<div className="my-1 h-px bg-border/60" />
						</>
					)}

					<Button
						type="button"
						variant="ghost"
						onClick={onViewAll}
						className="h-8 w-full justify-start gap-2 px-2 text-[12px] text-foreground"
					>
						<span className="icon-[mdi--view-grid-outline] h-4 w-4 text-muted-foreground" />
						<span className="flex-1 text-left">{labels.viewAll}</span>
						<span className="text-[10px] tabular-nums text-muted-foreground/45">{basesCount}</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						onClick={onCreate}
						className="h-8 w-full justify-start gap-2 px-2 text-[12px] font-medium text-primary hover:bg-primary/10 hover:text-primary"
					>
						<span className="icon-[mdi--plus] h-4 w-4" />
						{labels.createBase}
					</Button>
				</PopoverContent>
			</Popover>

			{renameDialog}
		</>
	);
}
