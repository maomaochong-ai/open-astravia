import { Button } from "@vetta/ui";
import type { JSX, ReactNode } from "react";
import { TextCodeEditorView } from "./TextCodeEditorView";

export type TextFileEditorMode = "edit" | "preview";

export interface TextFileEditorViewLabels {
	loading: string;
	edit: string;
	preview: string;
	save: string;
	reload: string;
	overwrite: string;
}

export type TextFileEditorViewState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| {
			status: "ready";
			mode: TextFileEditorMode;
			statusLabel: string;
			dirty: boolean;
			saving: boolean;
			hasConflict: boolean;
			conflictMessage: string;
			inlineError?: string;
			documentKey: string;
			content: string;
			extension: string;
			lineEnding: "lf" | "crlf";
			/**
			 * When set, host can switch to a rendered preview surface.
			 * When omitted, the toolbar has no edit/preview toggle (source-only).
			 */
			previewContent?: ReactNode;
	  };

export interface TextFileEditorViewProps {
	state: TextFileEditorViewState;
	labels: TextFileEditorViewLabels;
	onModeChange: (mode: TextFileEditorMode) => void;
	onChange: (content: string) => void;
	onSave: () => void;
	onReload: () => void;
	onOverwrite: () => void;
}

export function TextFileEditorView({
	state,
	labels,
	onModeChange,
	onChange,
	onSave,
	onReload,
	onOverwrite,
}: TextFileEditorViewProps): JSX.Element {
	if (state.status === "loading") {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
				<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin text-primary" />
				{labels.loading}
			</div>
		);
	}

	if (state.status === "error") {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
				<div className="flex size-10 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
					<span className="icon-[solar--danger-triangle-linear] h-5 w-5 text-destructive" />
				</div>
				<p className="max-w-72 text-[13px] leading-relaxed text-muted-foreground">{state.message}</p>
				<Button variant="outline" size="sm" onClick={onReload}>
					<span className="icon-[solar--refresh-linear] h-3.5 w-3.5" />
					{labels.reload}
				</Button>
			</div>
		);
	}

	const hasPreview = state.previewContent != null;
	const showPreview = hasPreview && state.mode === "preview";

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			<div className="flex min-h-9 shrink-0 items-center gap-1.5 border-b border-border/40 bg-card/30 px-2">
				{hasPreview ? (
					<div className="flex items-center rounded-lg border border-border/40 bg-muted/40 p-0.5">
						<Button
							variant="ghost"
							size="xs"
							aria-pressed={state.mode === "edit"}
							className={
								state.mode === "edit"
									? "bg-background text-foreground shadow-xs hover:bg-background"
									: "text-muted-foreground"
							}
							onClick={() => onModeChange("edit")}
						>
							<span className="icon-[solar--pen-2-linear] h-3 w-3" />
							{labels.edit}
						</Button>
						<Button
							variant="ghost"
							size="xs"
							aria-pressed={state.mode === "preview"}
							className={
								state.mode === "preview"
									? "bg-background text-foreground shadow-xs hover:bg-background"
									: "text-muted-foreground"
							}
							onClick={() => onModeChange("preview")}
						>
							<span className="icon-[solar--eye-linear] h-3 w-3" />
							{labels.preview}
						</Button>
					</div>
				) : null}
				<div
					className={`flex min-w-0 flex-1 items-center gap-1.5 ${state.dirty || state.saving ? "text-primary" : "text-muted-foreground"}`}
					aria-live="polite"
				>
					<span
						className={
							state.saving
								? "icon-[solar--refresh-linear] size-3 shrink-0 animate-spin"
								: state.dirty
									? "icon-[solar--pen-new-square-linear] size-3 shrink-0"
									: "icon-[solar--check-circle-linear] size-3 shrink-0"
						}
					/>
					<span className="truncate text-[11px]">{state.statusLabel}</span>
				</div>
				<Button
					variant={state.dirty ? "primary" : "ghost"}
					size="xs"
					disabled={!state.dirty || state.saving || state.hasConflict}
					onClick={onSave}
				>
					<span className="icon-[solar--diskette-linear] h-3 w-3" />
					{labels.save}
				</Button>
			</div>

			{state.hasConflict ? (
				<div
					className="mx-2 mt-2 shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 p-2"
					role="alert"
				>
					<div className="flex items-start gap-2">
						<span className="icon-[solar--danger-triangle-linear] mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
						<p className="min-w-0 flex-1 text-[11px] leading-relaxed text-destructive">
							{state.conflictMessage}
						</p>
					</div>
					<div className="mt-1.5 flex justify-end gap-1">
						<Button variant="outline" size="xs" onClick={onReload}>
							{labels.reload}
						</Button>
						<Button variant="destructive" size="xs" onClick={onOverwrite}>
							{labels.overwrite}
						</Button>
					</div>
				</div>
			) : null}

			{state.inlineError ? (
				<div
					className="mx-2 mt-2 flex shrink-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] leading-relaxed text-destructive"
					role="alert"
				>
					<span className="icon-[solar--danger-circle-linear] mt-0.5 size-3.5 shrink-0" />
					<span>{state.inlineError}</span>
				</div>
			) : null}

			{showPreview ? (
				state.previewContent
			) : (
				<TextCodeEditorView
					documentKey={state.documentKey}
					initialValue={state.content}
					extension={state.extension}
					lineEnding={state.lineEnding}
					onChange={onChange}
				/>
			)}
		</div>
	);
}
