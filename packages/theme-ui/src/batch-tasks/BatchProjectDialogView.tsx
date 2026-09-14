import type { JSX, ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@vetta-org/ui";

export interface BatchProjectDialogViewLabels {
	readonly title: string;
	readonly cancel: string;
	readonly submit: string;
}

export interface BatchProjectDialogViewProps {
	readonly open: boolean;
	readonly onClose: () => void;
	readonly onSubmit: () => void;
	readonly canSubmit: boolean;
	readonly labels: BatchProjectDialogViewLabels;
	/** Form body stays host-owned (fields may still use desktop adapters). */
	readonly form: ReactNode;
}

export function BatchProjectDialogView({
	open,
	onClose,
	onSubmit,
	canSubmit,
	labels,
	form,
}: BatchProjectDialogViewProps): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={(value) => !value && onClose()}>
			<DialogContent
				className="flex max-h-[82vh] flex-col gap-0 overflow-hidden rounded-xl border border-border/60 bg-card/95 p-0 backdrop-blur-md sm:max-w-xl"
				showCloseButton={false}
			>
				<DialogHeader className="sr-only">
					<DialogTitle>{labels.title}</DialogTitle>
				</DialogHeader>

				<div className="flex-1 overflow-y-auto px-7 pt-6 pb-4">{form}</div>

				<div className="flex items-center justify-end gap-2 border-t border-border/40 px-5 py-3">
					<Button
						variant="ghost"
						onClick={onClose}
						className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground hover:text-foreground"
					>
						<span className="icon-[solar--close-circle-linear] h-4 w-4" />
						<span>{labels.cancel}</span>
					</Button>
					<Button
						onClick={onSubmit}
						disabled={!canSubmit}
						className="h-9 rounded-lg px-4 text-[13px]"
					>
						<span className="icon-[solar--check-circle-linear] h-4 w-4" />
						<span>{labels.submit}</span>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
