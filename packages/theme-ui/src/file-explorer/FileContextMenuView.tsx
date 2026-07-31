import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type JSX, type ReactNode } from "react";

export interface FileContextMenuViewLabels {
	newFile: string;
	newFolder: string;
	openInFolder: string;
	copyName: string;
	rename: string;
	delete: string;
}

export interface FileContextMenuViewProps {
	x: number;
	y: number;
	labels: FileContextMenuViewLabels;
	onClose: () => void;
	onCreateFile: () => void;
	onCreateFolder: () => void;
	onOpenInFolder: () => void;
	onCopyName: () => void;
	onRename: () => void;
	onDelete: () => void;
	showEntryActions: boolean;
	pluginActions?: readonly FileContextMenuPluginAction[];
}

export interface FileContextMenuPluginAction {
	id: string;
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
}

/**
 * File tree context menu shell. Host wires IPC / rename atom / i18n.
 */
export function FileContextMenuView({
	x,
	y,
	labels,
	onClose,
	onCreateFile,
	onCreateFolder,
	onOpenInFolder,
	onCopyName,
	onRename,
	onDelete,
	showEntryActions,
	pluginActions = [],
}: FileContextMenuViewProps): JSX.Element {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [onClose]);

	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [onClose]);

	return (
		<AnimatePresence>
			<motion.div
				ref={menuRef}
				initial={{ opacity: 0, scale: 0.95 }}
				animate={{ opacity: 1, scale: 1 }}
				exit={{ opacity: 0, scale: 0.95 }}
				transition={{ duration: 0.12, ease: [0.25, 0.1, 0.25, 1] }}
				className="fixed z-50 w-[180px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg"
				style={{
					left: `${x}px`,
					top: `${y}px`,
				}}
			>
				<button
					type="button"
					onClick={onCreateFile}
					className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
				>
					<span className="icon-[solar--document-add-linear] h-3.5 w-3.5" />
					{labels.newFile}
				</button>
				<button
					type="button"
					onClick={onCreateFolder}
					className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
				>
					<span className="icon-[solar--add-folder-linear] h-3.5 w-3.5" />
					{labels.newFolder}
				</button>
				<div className="mx-1.5 my-1 h-px bg-border" />
				<button
					type="button"
					onClick={onOpenInFolder}
					className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
				>
					<span className="icon-[solar--folder-open-linear] h-3.5 w-3.5" />
					{labels.openInFolder}
				</button>
				<button
					type="button"
					onClick={onCopyName}
					className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
				>
					<span className="icon-[solar--copy-linear] h-3.5 w-3.5" />
					{labels.copyName}
				</button>
				{pluginActions.length > 0 || showEntryActions ? <div className="mx-1.5 my-1 h-px bg-border" /> : null}
				{pluginActions.map((action) => (
					<button
						key={action.id}
						type="button"
						onClick={action.onSelect}
						className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
					>
						<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
							{action.icon ?? <span className="icon-[solar--magic-stick-3-linear] h-3.5 w-3.5" />}
						</span>
						<span className="truncate">{action.label}</span>
					</button>
				))}
				{pluginActions.length > 0 && showEntryActions ? (
					<div className="mx-1.5 my-1 h-px bg-border" />
				) : null}
				{showEntryActions ? (
					<>
						<button
							type="button"
							onClick={onRename}
							className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
						>
							<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
							{labels.rename}
						</button>
						<button
							type="button"
							onClick={onDelete}
							className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-destructive transition-colors hover:bg-accent"
						>
							<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
							{labels.delete}
						</button>
					</>
				) : null}
			</motion.div>
		</AnimatePresence>
	);
}
