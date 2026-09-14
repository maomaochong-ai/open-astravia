import { useState, type JSX } from "react";
import { Button } from "@vetta-org/ui";
import { McpDefaultIcon } from "./McpDefaultIcon";
import type { SettingSectionMeta } from "./SettingChrome";

export interface BuiltinMcpPresetRowView {
	readonly id: string;
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly iconUrl: string;
	readonly needsKey: boolean;
}

export interface BuiltinMcpSectionViewLabels {
	readonly listTitle: string;
	readonly sectionHint: string;
	readonly allAdded: string;
	readonly added: string;
	readonly processing: string;
	readonly connect: string;
	readonly add: string;
	readonly remove: string;
}

export interface BuiltinMcpSectionViewProps {
	readonly items: readonly BuiltinMcpPresetRowView[];
	readonly addedNames: Set<string>;
	readonly busyName: string | null;
	readonly variant: "full" | "discover";
	readonly section: SettingSectionMeta;
	readonly labels: BuiltinMcpSectionViewLabels;
	readonly onAdd: (name: string) => void;
	readonly onRemove: (name: string) => void;
}

const GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5";

export function BuiltinMcpSectionView({
	items,
	addedNames,
	busyName,
	variant,
	section,
	labels,
	onAdd,
	onRemove,
}: BuiltinMcpSectionViewProps): JSX.Element {
	return (
		<div
			id={section.id}
			data-setting-section-id={section.id}
			data-setting-section-highlight-target={section.id}
		>
			{variant === "full" && (
				<div className="mb-3">
					<div className="text-[12px] font-medium text-foreground">{labels.listTitle}</div>
					<p className="mt-0.5 text-[11px] text-muted-foreground">{labels.sectionHint}</p>
				</div>
			)}

			{items.length === 0 ? (
				<div className="rounded-xl bg-card px-5 py-8 text-center text-[12px] text-muted-foreground">
					{labels.allAdded}
				</div>
			) : (
				<div className={GRID_CLASS}>
					{items.map((preset) => (
						<BuiltinMcpCard
							key={preset.id}
							preset={preset}
							added={addedNames.has(preset.name)}
							busy={busyName === preset.name}
							discover={variant === "discover"}
							labels={labels}
							onAdd={() => onAdd(preset.name)}
							onRemove={() => onRemove(preset.name)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function BuiltinMcpCard({
	preset,
	added,
	busy,
	discover,
	labels,
	onAdd,
	onRemove,
}: {
	preset: BuiltinMcpPresetRowView;
	added: boolean;
	busy: boolean;
	discover: boolean;
	labels: BuiltinMcpSectionViewLabels;
	onAdd: () => void;
	onRemove: () => void;
}): JSX.Element {
	const [imgFailed, setImgFailed] = useState(false);

	return (
		<div
			className={`group flex flex-col overflow-hidden rounded-xl transition-colors duration-200 ${
				added
					? "bg-card ring-1 ring-inset ring-emerald-500/20 hover:bg-accent"
					: "bg-card hover:bg-accent"
			}`}
		>
			<div className="flex flex-1 flex-col gap-2.5 p-3.5">
				<div className="flex items-start gap-2.5">
					{!imgFailed ? (
						<img
							src={preset.iconUrl}
							alt=""
							className="h-10 w-10 shrink-0 rounded-lg object-contain"
							onError={() => setImgFailed(true)}
						/>
					) : (
						<McpDefaultIcon className="h-10 w-10 rounded-lg" />
					)}
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-1.5">
							<h4 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
								{preset.displayName}
							</h4>
							{added && (
								<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
									<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
									{labels.added}
								</span>
							)}
						</div>
						<p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70">
							{preset.description}
						</p>
					</div>
				</div>

				<div className="mt-auto flex justify-end pt-1">
					{added ? (
						discover ? (
							<Button variant="outline" size="sm" disabled className="opacity-80">
								<span className="icon-[mdi--check] h-3.5 w-3.5 text-emerald-400" />
								{labels.added}
							</Button>
						) : (
							<Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
								{busy ? labels.processing : labels.remove}
							</Button>
						)
					) : (
						<Button variant="primary" size="sm" disabled={busy} onClick={onAdd}>
							{busy ? labels.processing : preset.needsKey ? labels.connect : labels.add}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
