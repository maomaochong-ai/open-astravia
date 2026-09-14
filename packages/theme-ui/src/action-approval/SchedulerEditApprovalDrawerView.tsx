import type { JSX, ReactNode } from "react";
import {
	Button,
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	cn,
} from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface SchedulerEditApprovalDrawerViewLabels {
	readonly reject: string;
	readonly submit: string;
	readonly submitting: string;
	readonly taskId: string;
	readonly permission: string;
}

export interface SchedulerEditApprovalDrawerViewProps {
	readonly title: string;
	readonly description: string;
	readonly taskId?: string;
	readonly loadingMessage?: string;
	readonly loadError?: string | null;
	readonly error?: string | null;
	readonly responding: boolean;
	readonly countdown: string;
	readonly labels: SchedulerEditApprovalDrawerViewLabels;
	readonly onReject: () => void;
	readonly onSubmit?: () => void;
	readonly canSubmit: boolean;
	/** Host injects SchedulerApprovalFields (desktop-bound). */
	readonly fields?: ReactNode;
	readonly className?: string;
	readonly classNames?: {
		readonly content?: string;
		readonly header?: string;
		readonly body?: string;
		readonly footer?: string;
	};
}

export function SchedulerEditApprovalDrawerView({
	title,
	description,
	taskId,
	loadingMessage,
	loadError,
	error,
	responding,
	countdown,
	labels,
	onReject,
	onSubmit,
	canSubmit,
	fields,
	className,
	classNames,
}: SchedulerEditApprovalDrawerViewProps): JSX.Element {
	return (
		<Drawer open direction="right" dismissible={false}>
			<DrawerContent
				className={cn(
					"w-[min(520px,calc(100vw-2rem))] overflow-visible sm:max-w-[520px]",
					className,
					classNames?.content,
				)}
			>
				<ThemeSurface slot="root.approval.schedulerEdit.panel" />
				<div className="relative z-10 flex min-h-0 flex-1 flex-col">
					<DrawerHeader className={cn("border-b border-border/60", classNames?.header)}>
						<DrawerTitle>{title}</DrawerTitle>
						<DrawerDescription>{description}</DrawerDescription>
					</DrawerHeader>
					<div className={cn("min-h-0 flex-1 overflow-y-auto p-4", classNames?.body)}>
						{loadingMessage && (
							<div className="py-10 text-center text-[12px] text-muted-foreground">{loadingMessage}</div>
						)}
						{!loadingMessage && loadError && (
							<div className="py-10 text-center text-[12px] text-destructive">{loadError}</div>
						)}
						{!loadingMessage && !loadError && fields && (
							<>
								{taskId && (
									<div className="mb-4 rounded-lg border border-border/50 bg-card/40 p-3">
										<div className="text-[11px] text-muted-foreground">{labels.taskId}</div>
										<div className="mt-1 break-all font-mono text-[11px] text-foreground">{taskId}</div>
									</div>
								)}
								{fields}
								<div className="mt-4 text-[11px] text-muted-foreground">{labels.permission}</div>
								{error && <div className="mt-2 text-[11px] text-destructive">{error}</div>}
							</>
						)}
					</div>
					<DrawerFooter className={cn("border-t border-border/60", classNames?.footer)}>
						<Button variant="outline" size="sm" disabled={responding} onClick={onReject}>
							{labels.reject} ({countdown})
						</Button>
						{canSubmit && (
							<Button size="sm" disabled={responding} onClick={onSubmit}>
								{responding ? labels.submitting : labels.submit}
							</Button>
						)}
					</DrawerFooter>
				</div>
			</DrawerContent>
		</Drawer>
	);
}
