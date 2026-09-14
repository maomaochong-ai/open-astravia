import type { JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";

export interface WorkflowBindStageView {
	readonly name: string;
}

export interface WorkflowBindItemView {
	readonly id: number;
	readonly name: string;
	readonly description?: string;
	readonly stages: readonly WorkflowBindStageView[];
}

export interface WorkflowBindDialogViewLabels {
	readonly title: string;
	readonly description: string;
	readonly empty: string;
	readonly stageCount: (n: number) => string;
	readonly cancel: string;
	readonly binding: string;
	readonly bind: string;
}

export interface WorkflowBindDialogViewProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly loading: boolean;
	readonly workflows: readonly WorkflowBindItemView[];
	readonly selectedId: number | null;
	readonly onSelect: (id: number) => void;
	readonly binding: boolean;
	readonly error: string | null;
	readonly onBind: () => void;
	readonly labels: WorkflowBindDialogViewLabels;
}

export function WorkflowBindDialogView({
	open,
	onOpenChange,
	loading,
	workflows,
	selectedId,
	onSelect,
	binding,
	error,
	onBind,
	labels,
}: WorkflowBindDialogViewProps): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<span className="icon-[mdi--sitemap-outline] text-lg text-primary" />
						{labels.title}
					</DialogTitle>
					<DialogDescription>{labels.description}</DialogDescription>
				</DialogHeader>

				{loading ? (
					<div className="flex h-40 items-center justify-center">
						<span className="icon-[mdi--loading] h-5 w-5 animate-spin text-muted-foreground/50" />
					</div>
				) : workflows.length === 0 ? (
					<div className="flex h-40 items-center justify-center text-xs text-muted-foreground/50">
						{labels.empty}
					</div>
				) : (
					<div className="max-h-64 space-y-2 overflow-y-auto">
						{workflows.map((wf) => {
							const isSelected = selectedId === wf.id;
							return (
								<button
									key={wf.id}
									type="button"
									onClick={() => onSelect(wf.id)}
									className={`w-full rounded-lg border p-3 text-left transition-colors ${
										isSelected
											? "border-primary bg-primary/5"
											: "border-border/50 bg-muted/20 hover:border-border hover:bg-muted/40"
									}`}
								>
									<div className="mb-1 flex items-center gap-2">
										<span className="text-[13px] font-medium text-foreground">{wf.name}</span>
										<span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
											{labels.stageCount(wf.stages.length)}
										</span>
									</div>
									{wf.description && (
										<p className="mb-2 text-[11px] text-muted-foreground/70">{wf.description}</p>
									)}
									<div className="flex flex-wrap gap-1">
										{wf.stages.map((stage, i) => (
											<span
												key={`${stage.name}-${i}`}
												className="rounded-md bg-accent/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
											>
												{stage.name}
											</span>
										))}
									</div>
								</button>
							);
						})}
					</div>
				)}

				{error && (
					<div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
						<span className="icon-[mdi--alert-circle-outline] shrink-0 text-sm" />
						{error}
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={binding}>
						{labels.cancel}
					</Button>
					<Button onClick={onBind} disabled={binding || selectedId === null}>
						{binding ? (
							<>
								<span className="icon-[mdi--loading] animate-spin" data-icon="inline-start" />
								{labels.binding}
							</>
						) : (
							<>
								<span className="icon-[mdi--link-variant] text-xs" data-icon="inline-start" />
								{labels.bind}
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
