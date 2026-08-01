import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type JSX, type ReactNode } from "react";

export interface FileContextMenuViewLabels {
	newFile: string;
	newFolder: string;
	openInFolder: string;
	copy: string;
	paste: string;
	copyPath: string;
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
	onCopy: () => void;
	onPaste: () => void;
	onCopyPath: () => void;
	onCopyName: () => void;
	onRename: () => void;
	onDelete: () => void;
	/** Entry row menu (copy/rename/delete…). False for blank/root background. */
	showEntryActions: boolean;
	canPaste: boolean;
	canRename: boolean;
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
 *
 * Background (root) menu: new file/folder, open root, paste.
 * Entry menu: + copy / path / name / rename / delete / plugins.
 */
export function FileContextMenuView({
	x,
	y,
	labels,
	onClose,
	onCreateFile,
	onCreateFolder,
	onOpenInFolder,
	onCopy,
	onPaste,
	onCopyPath,
	onCopyName,
	onRename,
	onDelete,
	showEntryActions,
	canPaste,
	canRename,
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
				{showEntryActions ? (
					<button
						type="button"
						onClick={onCopy}
						className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
					>
						<span className="icon-[solar--copy-linear] h-3.5 w-3.5" />
						{labels.copy}
					</button>
				) : null}
				<button
					type="button"
					disabled={!canPaste}
					onClick={onPaste}
					className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
				>
					<span className="icon-[solar--clipboard-linear] h-3.5 w-3.5" />
					{labels.paste}
				</button>
				{showEntryActions ? (
					<>
						<button
							type="button"
							onClick={onCopyPath}
							className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
						>
							<span className="icon-[solar--link-linear] h-3.5 w-3.5" />
							{labels.copyPath}
						</button>
						<button
							type="button"
							onClick={onCopyName}
							className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
						>
							<span className="icon-[solar--text-linear] h-3.5 w-3.5" />
							{labels.copyName}
						</button>
					</>
				) : null}
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
						{canRename ? (
							<button
								type="button"
								onClick={onRename}
								className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
							>
								<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
								{labels.rename}
							</button>
						) : null}
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
