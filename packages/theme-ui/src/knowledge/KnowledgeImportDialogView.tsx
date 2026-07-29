import { useState, type JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	cn,
} from "@vetta/ui";

const NEW_BASE = "__new__";

export interface KnowledgeImportBaseOptionView {
	readonly id: string;
	readonly name: string;
}

export interface KnowledgeImportDialogViewLabels {
	readonly createTitle: string;
	readonly addTitle: string;
	readonly createDesc: string;
	readonly addDesc: string;
	readonly addTo: string;
	readonly createBase: string;
	readonly nameLabel: string;
	readonly cancel: string;
	readonly createBtn: string;
	readonly startBtn: string;
	readonly newBaseName: string;
}

export interface KnowledgeImportDialogViewProps {
	readonly createOnly: boolean;
	readonly knowledgeBases: readonly KnowledgeImportBaseOptionView[];
	readonly initialTargetId: string;
	readonly onClose: () => void;
	readonly onConfirm: (confirmation: {
		targetId: string | null;
		name: string;
		sourcePaths: string[];
	}) => void;
	readonly sourcePaths: readonly string[];
	readonly labels: KnowledgeImportDialogViewLabels;
}

export function KnowledgeImportDialogView({
	createOnly,
	knowledgeBases,
	initialTargetId,
	onClose,
	onConfirm,
	sourcePaths,
	labels,
}: KnowledgeImportDialogViewProps): JSX.Element {
	const [target, setTarget] = useState(initialTargetId);
	const [name, setName] = useState(labels.newBaseName);

	const creatingNew = target === NEW_BASE;
	const validName = name.trim().length > 0 && !/[\\/]/.test(name.trim());
	const canSubmit = creatingNew ? validName : true;

	const confirm = () => {
		onConfirm({
			targetId: creatingNew ? null : target,
			name: name.trim(),
			sourcePaths: [...sourcePaths],
		});
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-[460px]">
				<DialogHeader>
					<div className="flex items-start gap-3">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<span className="icon-[mdi--folder-plus-outline] h-5 w-5" />
						</div>
						<div>
							<DialogTitle>{createOnly ? labels.createTitle : labels.addTitle}</DialogTitle>
							<DialogDescription className="mt-1">
								{createOnly ? labels.createDesc : labels.addDesc}
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				{!createOnly && knowledgeBases.length > 0 && (
					<div className="grid gap-1.5">
						<span className="text-[11px] font-medium text-foreground">{labels.addTo}</span>
						<div className="max-h-44 overflow-y-auto rounded-lg border border-border/60 p-1">
							{knowledgeBases.map((base) => (
								<button
									key={base.id}
									type="button"
									onClick={() => setTarget(base.id)}
									className={cn(
										"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
										target === base.id ? "bg-primary/10 text-foreground" : "hover:bg-accent",
									)}
								>
									<span className="icon-[mdi--book-outline] h-4 w-4 text-muted-foreground" />
									<span className="min-w-0 flex-1 truncate">{base.name}</span>
									{target === base.id && <span className="icon-[mdi--check] h-4 w-4 text-primary" />}
								</button>
							))}
							<button
								type="button"
								onClick={() => setTarget(NEW_BASE)}
								className={cn(
									"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium transition-colors",
									creatingNew ? "bg-primary/10 text-primary" : "text-primary hover:bg-primary/10",
								)}
							>
								<span className="icon-[mdi--plus] h-4 w-4" />
								{labels.createBase}
							</button>
						</div>
					</div>
				)}

				{creatingNew && (
					<label htmlFor="knowledge-base-name" className="text-[11px] font-medium text-foreground">
						{labels.nameLabel}
						<input
							id="knowledge-base-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							className={cn(
								"mt-1.5 h-9 w-full min-w-0 rounded-lg border border-border/60 bg-background px-2.5 py-1 text-[12px] font-normal shadow-none outline-none focus-visible:border-ring/60",
							)}
							// biome-ignore lint/a11y/noAutofocus: preserve original dialog focus
							autoFocus
						/>
					</label>
				)}

				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						{labels.cancel}
					</Button>
					<Button variant="primary" disabled={!canSubmit} onClick={confirm}>
						<span className="icon-[mdi--folder-check-outline] h-4 w-4" />
						{createOnly ? labels.createBtn : labels.startBtn}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export { NEW_BASE as KNOWLEDGE_IMPORT_NEW_BASE };
