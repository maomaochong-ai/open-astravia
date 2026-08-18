import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Button, Dialog, DialogContent } from "@vetta/ui";

export interface NewProjectDialogViewLabels {
	readonly title: string;
	readonly description: string;
	readonly placeholder: string;
	readonly cancel: string;
	readonly create: string;
	readonly emptyError: string;
	readonly invalidError: string;
	readonly duplicateError: string;
}

export interface NewProjectDialogViewProps {
	readonly onConfirm: (name: string) => void;
	readonly onCancel: () => void;
	readonly labels: NewProjectDialogViewLabels;
	/**
	 * 已被占用的项目名。命中时在确认那一刻就拦下来——否则重名会一路走到落盘，
	 * 静默复用同名项目，用户以为新建了一个却发现会话进了旧项目。
	 */
	readonly isNameTaken?: (name: string) => boolean;
}

export function NewProjectDialogView({
	onConfirm,
	onCancel,
	labels,
	isNameTaken,
}: NewProjectDialogViewProps): JSX.Element {
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleSubmit = useCallback(() => {
		const trimmed = name.trim();
		if (!trimmed) {
			setError(labels.emptyError);
			return;
		}
		if (/[/\\:*?"<>|]/.test(trimmed)) {
			setError(labels.invalidError);
			return;
		}
		if (isNameTaken?.(trimmed)) {
			setError(labels.duplicateError);
			return;
		}
		onConfirm(trimmed);
	}, [name, onConfirm, isNameTaken, labels.emptyError, labels.invalidError, labels.duplicateError]);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<DialogContent
				showCloseButton={false}
				onEscapeKeyDown={(e) => {
					e.preventDefault();
					onCancel();
				}}
				onInteractOutside={(e) => e.preventDefault()}
			>
				<p className="mb-1 text-[13px] font-semibold text-foreground">{labels.title}</p>
				<p className="mb-3 text-[12px] text-muted-foreground/50">{labels.description}</p>
				<input
					ref={inputRef}
					type="text"
					value={name}
					onChange={(e) => {
						setName(e.target.value);
						setError("");
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSubmit();
					}}
					placeholder={labels.placeholder}
					className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-input"
				/>
				{error && <p className="mb-1 text-[11px] text-destructive">{error}</p>}
				<div className="mt-3 flex justify-end gap-2">
					<Button variant="ghost" size="sm" onClick={onCancel}>
						{labels.cancel}
					</Button>
					<Button variant="primary" size="sm" onClick={handleSubmit}>
						{labels.create}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
