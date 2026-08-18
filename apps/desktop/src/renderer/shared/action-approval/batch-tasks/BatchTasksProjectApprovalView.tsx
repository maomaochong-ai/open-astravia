import { BatchProjectFormFields } from "@domains/batch-tasks/components/BatchProjectFormFields";
import { useThemeComponent } from "@vetta/theme-sdk";
import { BatchTasksApprovalFrameView } from "@vetta/theme-ui/action-approval";
import { Drawer, DrawerContent } from "@vetta/ui";
import type { BatchTasksProjectApprovalModel } from "./useBatchTasksProjectApprovalModel";

function ValueRow({ label, value }: { label: string; value: string | number }): JSX.Element {
	return (
		<div className="flex items-start justify-between gap-4 py-1.5">
			<span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
			<span className="min-w-0 break-words text-right text-[11px] font-medium text-foreground">{value}</span>
		</div>
	);
}

export function BatchTasksProjectApprovalView(model: BatchTasksProjectApprovalModel): JSX.Element {
	const ThemedBatchTasksApprovalFrameView = useThemeComponent(
		"root.approval.batchTasksFrameView",
		BatchTasksApprovalFrameView,
	);

	if (model.phase === "loading") {
		return (
			<Drawer open direction="right" dismissible={false}>
				<DrawerContent className="w-[min(560px,calc(100vw-2rem))] sm:max-w-[560px]">
					<div className="min-h-0 flex-1 overflow-y-auto">
						<div className="py-10 text-center text-[12px] text-muted-foreground">{model.loadingLabel}</div>
					</div>
				</DrawerContent>
			</Drawer>
		);
	}

	if (model.phase === "not_found" && model.frame) {
		return (
			<ThemedBatchTasksApprovalFrameView {...model.frame}>
				<div className="py-10 text-center text-[12px] text-destructive">{model.loadError}</div>
			</ThemedBatchTasksApprovalFrameView>
		);
	}

	if (!model.frame) {
		return <></>;
	}

	const body = (
		<>
			{model.operation === "create" && (
				<>
					{(model.formData.executionMode === "full-access" || model.formData.executionMode === undefined) && (
						<div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/15 p-3 text-amber-400">
							<span className="icon-[mdi--shield-alert-outline] mt-0.5 h-4 w-4 shrink-0" />
							<p className="text-[11px] leading-5">{model.fullAccessWarning}</p>
						</div>
					)}
					<BatchProjectFormFields
						value={model.formData}
						onChange={model.onFormChange}
						namePlaceholder={model.newProjectNamePlaceholder}
						folderLabel={model.sourceFoldersLabel}
					/>
				</>
			)}

			{model.operation === "update" && (
				<>
					<div className="rounded-lg border border-border/50 bg-background/50 px-3">
						<ValueRow label={model.targetProjectLabel} value={model.currentProjectName} />
						<div className="h-px bg-border/40" />
						<ValueRow label={model.projectPathFieldLabel} value={model.projectPathLabel} />
						<div className="h-px bg-border/40" />
						<ValueRow label={model.existingTasksLabel} value={model.taskCountLabel} />
					</div>
					<BatchProjectFormFields
						value={model.formData}
						onChange={model.onFormChange}
						namePlaceholder={model.projectNamePlaceholder}
						folderLabel={model.folderListLabel}
					/>
				</>
			)}

			{model.operation === "delete" && (
				<>
					<div className="rounded-lg border border-border/50 bg-background/50 px-3">
						<ValueRow label={model.targetProjectLabel} value={model.currentProjectName} />
						<div className="h-px bg-border/40" />
						<ValueRow label={model.projectPathFieldLabel} value={model.projectPathLabel} />
						<div className="h-px bg-border/40" />
						<ValueRow label={model.includedTasksLabel} value={model.taskCountLabel} />
					</div>
					<div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
						<span className="icon-[mdi--alert-outline] mt-0.5 h-4 w-4 shrink-0" />
						<p className="text-[11px] leading-5">{model.deleteWarning}</p>
					</div>
				</>
			)}

			{!model.operation && (
				<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-background/50 p-3 font-mono text-[10px] leading-4 text-foreground">
					{JSON.stringify(model.rawInput, null, 2)}
				</pre>
			)}
		</>
	);

	return <ThemedBatchTasksApprovalFrameView {...model.frame}>{body}</ThemedBatchTasksApprovalFrameView>;
}
