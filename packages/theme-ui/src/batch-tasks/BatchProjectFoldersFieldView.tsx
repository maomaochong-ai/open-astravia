import type { JSX } from "react";
import { Button, cn } from "@vetta/ui";

export interface BatchProjectFoldersFieldViewLabels {
	readonly folderModePicker: string;
	readonly folderModeText: string;
	readonly selectFolder: string;
	readonly folderTextHint: string;
}

export interface BatchProjectFoldersFieldViewProps {
	readonly emptyText: string;
	readonly folderInputMode: "picker" | "textarea";
	readonly folderText: string;
	readonly folders: readonly string[];
	readonly label: string;
	readonly onFolderTextChange: (value: string) => void;
	readonly onInputModeChange: (mode: "picker" | "textarea") => void;
	readonly onRemoveFolder: (folder: string) => void;
	readonly onSelectFolders: () => void;
	readonly labels: BatchProjectFoldersFieldViewLabels;
}

export function BatchProjectFoldersFieldView({
	emptyText,
	folderInputMode,
	folderText,
	folders,
	label,
	onFolderTextChange,
	onInputModeChange,
	onRemoveFolder,
	onSelectFolders,
	labels,
}: BatchProjectFoldersFieldViewProps): JSX.Element {
	return (
		<div>
			<div className="mb-2 flex items-center justify-between gap-3">
				<p className="text-sm font-medium text-foreground">{label}</p>
				<div className="inline-flex rounded-lg border border-border p-0.5">
					<button
						type="button"
						onClick={() => onInputModeChange("picker")}
						className={cn(
							"rounded-md px-2.5 py-1 text-xs transition-colors",
							folderInputMode === "picker"
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{labels.folderModePicker}
					</button>
					<button
						type="button"
						onClick={() => onInputModeChange("textarea")}
						className={cn(
							"rounded-md px-2.5 py-1 text-xs transition-colors",
							folderInputMode === "textarea"
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{labels.folderModeText}
					</button>
				</div>
			</div>
			{folderInputMode === "picker" ? (
				<Button type="button" variant="outline" size="sm" onClick={onSelectFolders}>
					{labels.selectFolder}
				</Button>
			) : (
				<>
					<textarea
						value={folderText}
						onChange={(event) => onFolderTextChange(event.target.value)}
						className={cn(
							"flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30",
							"min-h-[96px] text-sm",
						)}
						placeholder={"/path/to/project-a\n/path/to/project-b"}
					/>
					<p className="mt-2 text-xs text-muted-foreground/60">{labels.folderTextHint}</p>
				</>
			)}
			{folders.length > 0 ? (
				<div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-border p-2">
					{folders.map((folder) => (
						<div
							key={folder}
							className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent/50"
						>
							<span className="truncate text-sm text-foreground">{folder}</span>
							<button
								type="button"
								onClick={() => onRemoveFolder(folder)}
								className="ml-2 shrink-0 text-muted-foreground/50 hover:text-destructive"
							>
								<span className="icon-[solar--close-circle-linear] text-[14px]" />
							</button>
						</div>
					))}
				</div>
			) : (
				<p className="mt-3 text-xs text-muted-foreground/50">{emptyText}</p>
			)}
		</div>
	);
}
