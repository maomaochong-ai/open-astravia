import type { JSX, ReactNode } from "react";
import { Button, Dialog, DialogContent, Drawer, DrawerContent, cn } from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface BatchTasksApprovalFrameViewLabels {
	readonly reject: string;
	readonly confirm: string;
	readonly responding: string;
	readonly permission: string;
}

export interface BatchTasksApprovalFrameViewProps {
	readonly presentation: "dialog" | "drawer";
	readonly title: string;
	readonly summary: string;
	readonly icon: string;
	readonly badge?: string;
	readonly destructive?: boolean;
	readonly labels: BatchTasksApprovalFrameViewLabels;
	readonly responding: boolean;
	readonly countdown: string;
	readonly canApprove?: boolean;
	readonly error?: string | null;
	readonly onReject: () => void;
	readonly onApprove: () => void;
	readonly children: ReactNode;
	readonly className?: string;
	readonly classNames?: {
		readonly content?: string;
		readonly header?: string;
		readonly body?: string;
		readonly footer?: string;
	};
}

export function BatchTasksApprovalFrameView({
	presentation,
	title,
	summary,
	icon,
	badge,
	destructive,
	labels,
	responding,
	countdown,
	canApprove = true,
	error,
	onReject,
	onApprove,
	children,
	className,
	classNames,
}: BatchTasksApprovalFrameViewProps): JSX.Element {
	const content = (
		<>
			<div className={cn("border-b border-border/60 p-5", classNames?.header)}>
				<div className="flex items-start gap-3">
					<div
						className={cn(
							"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
							destructive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
						)}
					>
						<span className={`${icon} h-5 w-5`} />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
							{badge && (
								<span
									className={cn(
										"rounded-full px-2 py-0.5 text-[10px] font-semibold",
										destructive
											? "bg-destructive/10 text-destructive"
											: "bg-primary/10 text-primary",
									)}
								>
									{badge}
								</span>
							)}
						</div>
						<p className="mt-1 text-[12px] leading-5 text-muted-foreground">{summary}</p>
					</div>
				</div>
			</div>

			<div className={cn("space-y-3 p-5", classNames?.body)}>{children}</div>

			<div className={cn("border-t border-border/60 px-5 py-4", classNames?.footer)}>
				<div className="mb-3 text-[10px] text-muted-foreground">{labels.permission}</div>
				{error && <div className="mb-3 text-[11px] text-destructive">{error}</div>}
				<div className="flex justify-end gap-2">
					<Button variant="outline" size="sm" disabled={responding} onClick={onReject}>
						{labels.reject} ({countdown})
					</Button>
					<Button
						size="sm"
						variant={destructive ? "destructive" : "default"}
						disabled={responding || !canApprove}
						onClick={onApprove}
					>
						{responding ? labels.responding : labels.confirm}
					</Button>
				</div>
			</div>
		</>
	);

	if (presentation === "drawer") {
		return (
			<Drawer open direction="right" dismissible={false}>
				<DrawerContent
					className={cn(
						"w-[min(560px,calc(100vw-2rem))] overflow-visible sm:max-w-[560px]",
						className,
						classNames?.content,
					)}
				>
					<ThemeSurface slot="root.approval.batchTasks.panel" />
					<div className="relative z-10 min-h-0 flex-1 overflow-y-auto rounded-[inherit]">{content}</div>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog open>
			<DialogContent
				className={cn("overflow-visible p-0 sm:max-w-[560px]", className, classNames?.content)}
				showCloseButton={false}
				onInteractOutside={(event) => event.preventDefault()}
			>
				<ThemeSurface slot="root.approval.batchTasks.panel" />
				<div className="relative z-10 max-h-[90vh] overflow-y-auto rounded-[inherit]">{content}</div>
			</DialogContent>
		</Dialog>
	);
}
