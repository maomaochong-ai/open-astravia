import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type JSX } from "react";

export interface SessionContextMenuViewLabels {
	pin: string;
	rename: string;
	openInFolder: string;
	delete: string;
}

export interface SessionContextMenuViewProps {
	canDelete: boolean;
	canRename: boolean;
	labels: SessionContextMenuViewLabels;
	onClose: () => void;
	onDelete: () => void;
	onOpenInFolder: () => void;
	onRename: () => void;
	onTogglePin: () => void;
	x: number;
	y: number;
}

export function SessionContextMenuView({
	canDelete,
	canRename,
	labels,
	onClose,
	onDelete,
	onOpenInFolder,
	onRename,
	onTogglePin,
	x,
	y,
}: SessionContextMenuViewProps): JSX.Element {
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
				className="fixed z-[1000] w-[170px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl"
				style={{ left: `${x}px`, top: `${y}px` }}
			>
				<button
					type="button"
					onClick={onTogglePin}
					className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
				>
					<span className="icon-[solar--pin-linear] h-3.5 w-3.5" />
					{labels.pin}
				</button>
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
					onClick={onOpenInFolder}
					className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
				>
					<span className="icon-[solar--folder-open-linear] h-3.5 w-3.5" />
					{labels.openInFolder}
				</button>
				{canDelete ? (
					<button
						type="button"
						onClick={onDelete}
						className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-destructive transition-colors hover:bg-accent"
					>
						<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
						{labels.delete}
					</button>
				) : null}
			</motion.div>
		</AnimatePresence>
	);
}
