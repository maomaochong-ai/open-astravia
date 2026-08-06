import { useState, type JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	cn,
} from "@vetta/ui";

export interface KnowledgeRenameDialogViewLabels {
	readonly cancel: string;
	readonly confirm: string;
}

export interface KnowledgeRenameDialogViewProps {
	readonly title: string;
	readonly initialName: string;
	readonly onClose: () => void;
	readonly onSubmit: (newName: string) => void;
	readonly labels: KnowledgeRenameDialogViewLabels;
}

export function KnowledgeRenameDialogView({
	title,
	initialName,
	onClose,
	onSubmit,
	labels,
}: KnowledgeRenameDialogViewProps): JSX.Element {
	const [name, setName] = useState(initialName);
	const trimmed = name.trim();
	const canSubmit = trimmed.length > 0 && trimmed !== initialName && !/[\\/]/.test(trimmed);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-[420px]">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					className={cn(
						"h-8 w-full min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 py-1 text-base shadow-none transition-[border-color,background-color] outline-none placeholder:text-muted-foreground hover:border-border focus-visible:border-ring/60 md:text-sm dark:bg-input/20",
						"h-9 bg-background text-[12px]",
					)}
					// biome-ignore lint/a11y/noAutofocus: preserve original dialog focus behavior
					autoFocus
					onKeyDown={(event) => {
						if (event.key === "Enter" && canSubmit) onSubmit(trimmed);
					}}
				/>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						{labels.cancel}
					</Button>
					<Button variant="primary" disabled={!canSubmit} onClick={() => onSubmit(trimmed)}>
						{labels.confirm}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
