import { cn } from "@vetta/ui";
import { useEffect, useRef, useState, type JSX } from "react";
import { getFileIcon } from "./fileIcons";
import type { FileExplorerEntryKind } from "./types";

export interface FileTreeCreateRowProps {
	kind: FileExplorerEntryKind;
	depth: number;
	inputLabel: string;
	error: string | null;
	busy: boolean;
	onSubmit: (name: string) => void;
	onCancel: () => void;
}

export function FileTreeCreateRow({
	kind,
	depth,
	inputLabel,
	error,
	busy,
	onSubmit,
	onCancel,
}: FileTreeCreateRowProps): JSX.Element {
	const [value, setValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const isDirectory = kind === "directory";
	const icon = getFileIcon(value, isDirectory, false);

	useEffect(() => {
		if (!busy) inputRef.current?.focus();
	}, [busy]);

	function submit(): void {
		if (!busy) onSubmit(value.trim());
	}

	return (
		<div style={{ paddingLeft: `${depth * 16 + 6}px` }} className="py-[3px] pr-1.5">
			<div className="flex items-center gap-1.5 text-[12px]">
				<span className="h-3 w-3 shrink-0" />
				<span
					className={cn(
						icon,
						"h-3.5 w-3.5 shrink-0",
						isDirectory ? "text-primary" : "text-muted-foreground",
					)}
				/>
				<input
					ref={inputRef}
					type="text"
					value={value}
					disabled={busy}
					aria-label={inputLabel}
					onChange={(event) => setValue(event.target.value)}
					onBlur={() => {
						if (!busy) onCancel();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submit();
						} else if (event.key === "Escape") {
							event.preventDefault();
							onCancel();
						}
					}}
					className={cn(
						"min-w-0 flex-1 rounded border bg-background px-1 py-0 text-[12px] text-foreground outline-none",
						error ? "border-destructive" : "border-primary",
					)}
				/>
				{busy ? <span className="icon-[solar--refresh-linear] h-3 w-3 animate-spin text-muted-foreground" /> : null}
			</div>
			{error ? (
				<p className="truncate pl-8 pt-0.5 text-[10px] text-destructive" title={error}>
					{error}
				</p>
			) : null}
		</div>
	);
}
