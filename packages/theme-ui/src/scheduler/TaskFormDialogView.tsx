import type { JSX, ReactNode } from "react";
import { Button, Dialog, DialogContent } from "@vetta-org/ui";

export interface TaskFormDialogViewLabels {
	readonly cancel: string;
	readonly create: string;
	readonly save: string;
}

export interface TaskFormDialogViewProps {
	readonly canSubmit: boolean;
	readonly isEdit: boolean;
	readonly labels: TaskFormDialogViewLabels;
	readonly open: boolean;
	readonly onClose: () => void;
	readonly onSubmit: () => void;
	/** SchedulerTaskFields stays host-owned until that view migrates. */
	readonly fields: ReactNode;
}

export function TaskFormDialogView({
	canSubmit,
	isEdit,
	labels,
	open,
	onClose,
	onSubmit,
	fields,
}: TaskFormDialogViewProps): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={(value) => !value && onClose()}>
			<DialogContent
				className="flex max-h-[88vh] flex-col gap-0 overflow-hidden rounded-xl border border-border/60 bg-card/95 p-0 backdrop-blur-md max-w-[min(52rem,calc(100%-2rem))]"
				showCloseButton={false}
			>
				<div className="flex-1 overflow-y-auto px-7 py-6">{fields}</div>

				<div className="flex items-center justify-end gap-2 border-t border-border/40 px-5 py-3">
					<Button
						type="button"
						variant="ghost"
						onClick={onClose}
						className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground hover:text-foreground"
					>
						<span className="icon-[mdi--close] h-4 w-4" />
						<span>{labels.cancel}</span>
					</Button>
					<Button
						onClick={onSubmit}
						disabled={!canSubmit}
						className="h-9 rounded-lg bg-primary px-4 text-[13px] text-primary-foreground hover:bg-primary/90"
					>
						<span className="icon-[mdi--check] h-4 w-4" />
						<span>{isEdit ? labels.save : labels.create}</span>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
