import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";

export type ProjectContextMenuScope = "conversation" | "claw";

export interface ProjectContextMenuViewLabels {
	openInFolder: string;
	archiveProject: string;
	removeFromList: string;
	deleteProject: string;
	clearConversation: string;
	clearConversationDisabled: string;
	clearClaw: string;
	clearClawDisabled: string;
	clawSettings: string;
}

export interface ProjectContextMenuViewProps {
	/**
	 * False when the project has no counterpart on this computer (a remote project):
	 * there is nothing for the system file manager to show. Defaults to true.
	 */
	canOpenInFolder?: boolean;
	clearClawDisabled?: boolean;
	clearConversationDisabled?: boolean;
	defaultScope?: ProjectContextMenuScope;
	isDefault: boolean;
	labels: ProjectContextMenuViewLabels;
	onArchive: () => void;
	onClearClaw?: () => void;
	onClearConversation?: () => void;
	onClose: () => void;
	onDelete: () => void;
	onOpenClawSettings?: () => void;
	onOpenInFolder: () => void;
	onRemove: () => void;
	x: number;
	y: number;
}

export function ProjectContextMenuView({
	canOpenInFolder = true,
	clearClawDisabled,
	clearConversationDisabled,
	defaultScope,
	isDefault,
	labels,
	onArchive,
	onClearClaw,
	onClearConversation,
	onClose,
	onDelete,
	onOpenClawSettings,
	onOpenInFolder,
	onRemove,
	x,
	y,
}: ProjectContextMenuViewProps): JSX.Element {
	const menuRef = useRef<HTMLDivElement>(null);
	const [adjustedPos, setAdjustedPos] = useState({ x, y });

	useLayoutEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		setAdjustedPos({
			x: x + rect.width > vw ? vw - rect.width - 4 : x,
			y: y + rect.height > vh ? vh - rect.height - 4 : y,
		});
	}, [x, y]);

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
				className="fixed z-[1000] w-[160px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl"
				style={{ left: `${adjustedPos.x}px`, top: `${adjustedPos.y}px` }}
			>
				{!isDefault && canOpenInFolder && (
					<button
						type="button"
						onClick={onOpenInFolder}
						className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
					>
						<span className="icon-[solar--folder-open-linear] h-3.5 w-3.5" />
						{labels.openInFolder}
					</button>
				)}
				{isDefault && defaultScope === "conversation" && onClearConversation && (
					<button
						type="button"
						disabled={clearConversationDisabled}
						title={clearConversationDisabled ? labels.clearConversationDisabled : undefined}
						onClick={() => {
							if (clearConversationDisabled) return;
							onClearConversation();
						}}
						className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-destructive transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
					>
						<span className="icon-[solar--broom-linear] h-3.5 w-3.5" />
						{labels.clearConversation}
					</button>
				)}
				{isDefault && defaultScope === "claw" && (
					<>
						{onClearClaw && (
							<button
								type="button"
								disabled={clearClawDisabled}
								title={clearClawDisabled ? labels.clearClawDisabled : undefined}
								onClick={() => {
									if (clearClawDisabled) return;
									onClearClaw();
								}}
								className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-destructive transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
							>
								<span className="icon-[solar--broom-linear] h-3.5 w-3.5" />
								{labels.clearClaw}
							</button>
						)}
						{onOpenClawSettings && (
							<button
								type="button"
								onClick={onOpenClawSettings}
								className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
							>
								<span className="icon-[solar--settings-linear] h-3.5 w-3.5" />
								{labels.clawSettings}
							</button>
						)}
					</>
				)}
				{!isDefault && (
					<button
						type="button"
						onClick={onArchive}
						className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
					>
						<span className="icon-[solar--archive-minimalistic-linear] h-3.5 w-3.5" />
						{labels.archiveProject}
					</button>
				)}
				{!isDefault && (
					<button
						type="button"
						onClick={onRemove}
						className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
					>
						<span className="icon-[solar--list-cross-minimalistic-linear] h-3.5 w-3.5" />
						{labels.removeFromList}
					</button>
				)}
				{!isDefault && (
					<>
						<div className="mx-1.5 my-1 h-px bg-border" />
						<button
							type="button"
							onClick={onDelete}
							className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-destructive transition-colors hover:bg-accent"
						>
							<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
							{labels.deleteProject}
						</button>
					</>
				)}
			</motion.div>
		</AnimatePresence>
	);
}
