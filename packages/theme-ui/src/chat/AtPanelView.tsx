import { AnimatePresence, motion } from "motion/react";
import type { JSX, RefObject } from "react";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface AtPanelClassNames {
	root?: string;
	content?: string;
	header?: string;
	list?: string;
	item?: string;
}

export interface AtPanelEntryModel {
	path: string;
	name: string;
	isDirectory: boolean;
	relPath?: string;
	index: number;
	active: boolean;
	icon: string;
}

export interface AtPanelLabels {
	header: string;
	headingMeta: string;
	loading: string;
	noResults: string;
	emptyDirectory: string;
	goUp: string;
	enterDirectory: string;
}

export interface AtPanelViewProps {
	open: boolean;
	loading: boolean;
	normalizedFilter: string;
	canGoUp: boolean;
	goUpActive: boolean;
	entries: AtPanelEntryModel[];
	labels: AtPanelLabels;
	panelRef: RefObject<HTMLDivElement | null>;
	className?: string;
	classNames?: AtPanelClassNames;
	onGoUp: () => void;
	onHoverIndex: (index: number) => void;
	onEntryClick: (entry: AtPanelEntryModel) => void;
}

export function AtPanelView({
	open,
	loading,
	normalizedFilter,
	canGoUp,
	goUpActive,
	entries,
	labels,
	panelRef,
	className,
	classNames,
	onGoUp,
	onHoverIndex,
	onEntryClick,
}: AtPanelViewProps): JSX.Element {
	return (
		<AnimatePresence>
			{open && (
				<motion.div
					ref={panelRef}
					initial={{ opacity: 0, y: 8, scaleY: 0.96 }}
					animate={{ opacity: 1, y: 0, scaleY: 1 }}
					exit={{ opacity: 0, y: 8, scaleY: 0.96 }}
					transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
					className={[
						"absolute inset-x-0 bottom-full z-50 mb-1.5 origin-bottom overflow-visible rounded-2xl border border-border bg-input-bar-bg",
						className,
						classNames?.root,
					]
						.filter(Boolean)
						.join(" ")}
					style={{
						maxHeight: 320,
					}}
				>
					<ThemeSurface slot="chat.atPanel" />
					<div className={["relative z-10 overflow-hidden rounded-[inherit]", classNames?.content].filter(Boolean).join(" ")}>
						<div className={["flex items-center gap-2 border-b border-border px-4 py-2.5", classNames?.header].filter(Boolean).join(" ")}>
							<span className="icon-[solar--mention-circle-linear] h-4 w-4 text-muted-foreground/50" />
							<span className="text-[12px] font-medium text-muted-foreground/50" title={labels.header}>
								{labels.header}
							</span>
							<span className="ml-auto font-mono text-[11px] text-muted-foreground/50">{labels.headingMeta}</span>
						</div>

						<div className="overflow-y-auto" style={{ maxHeight: 280 }}>
							{loading ? (
								<div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground/50">
									{labels.loading}
								</div>
							) : entries.length === 0 && !canGoUp ? (
								<div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground/50">
									{normalizedFilter ? labels.noResults : labels.emptyDirectory}
								</div>
							) : (
								<div className={["py-1", classNames?.list].filter(Boolean).join(" ")}>
									{canGoUp && (
										<button
											type="button"
											data-index={0}
											onMouseEnter={() => onHoverIndex(0)}
											onClick={onGoUp}
											className={["relative flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors", classNames?.item]
												.filter(Boolean)
												.join(" ")}
											style={{
												background: goUpActive
													? "color-mix(in srgb, var(--primary) 9%, transparent)"
													: "transparent",
											}}
										>
											{goUpActive && (
												<motion.span
													layoutId="at-active-marker"
													className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
													transition={{ type: "spring", stiffness: 500, damping: 32 }}
												/>
											)}
											<span className="icon-[solar--arrow-left-up-linear] h-4 w-4 text-muted-foreground/50" />
											<span className="text-[12px] text-muted-foreground/50" title={labels.goUp}>
												{labels.goUp}
											</span>
										</button>
									)}

									{entries.map((entry) => (
										<AtPanelEntry
											key={entry.path}
											entry={entry}
											className={classNames?.item}
											enterDirectoryLabel={labels.enterDirectory}
											onHover={() => onHoverIndex(entry.index)}
											onClick={() => onEntryClick(entry)}
										/>
									))}
								</div>
							)}
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

function AtPanelEntry({
	entry,
	className,
	enterDirectoryLabel,
	onHover,
	onClick,
}: {
	entry: AtPanelEntryModel;
	className?: string;
	enterDirectoryLabel: string;
	onHover: () => void;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			data-index={entry.index}
			onMouseEnter={onHover}
			onClick={onClick}
			className={["relative flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors", className]
				.filter(Boolean)
				.join(" ")}
			style={{
				background: entry.active ? "color-mix(in srgb, var(--primary) 9%, transparent)" : "transparent",
			}}
		>
			{entry.active && (
				<motion.span
					layoutId="at-active-marker"
					className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
					transition={{ type: "spring", stiffness: 500, damping: 32 }}
				/>
			)}
			<span
				className={`${entry.icon} h-4 w-4 shrink-0 ${entry.isDirectory ? "text-muted-foreground" : "text-muted-foreground/50"}`}
			/>
			<span
				className={`shrink-0 truncate text-[12.5px] ${entry.isDirectory ? "font-medium text-foreground" : "text-foreground"}`}
			>
				{entry.name}
			</span>
			{entry.relPath && entry.relPath !== entry.name && (
				<span className="ml-auto truncate text-right font-mono text-[10px] text-muted-foreground/40">
					{entry.relPath}
				</span>
			)}
			{entry.isDirectory && (
				<span className="ml-auto text-[10px] text-muted-foreground/50" title={enterDirectoryLabel}>
					{enterDirectoryLabel}
				</span>
			)}
		</button>
	);
}
