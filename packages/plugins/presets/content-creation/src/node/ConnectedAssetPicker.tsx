import { useTranslation } from "@vetta-org/plugin-sdk";
import { useState } from "react";
import { ContentAssetThumbnail } from "./ContentAssetThumbnail";
import type { ConnectedContentAsset } from "./material-assets";

const PAGE_SIZE = 40;

export interface ConnectedReferenceOption extends ConnectedContentAsset {
	slotId: string | null;
}

interface ConnectedAssetPickerProps {
	options: readonly ConnectedReferenceOption[];
	disabled: boolean;
	onSelect: (option: ConnectedReferenceOption) => void;
}

export function ConnectedAssetPicker({ options, disabled, onSelect }: ConnectedAssetPickerProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const filteredOptions = options.filter(
		({ asset }) =>
			!normalizedQuery ||
			asset.name.toLocaleLowerCase().includes(normalizedQuery) ||
			t(`asset.kind.${asset.kind}`).toLocaleLowerCase().includes(normalizedQuery),
	);

	if (options.length === 0) return null;

	return (
		<div className="w-full pt-0.5">
			<button
				type="button"
				className="flex h-8 w-full items-center justify-between rounded-lg border border-border/70 bg-background/45 px-2.5 text-[11px] font-medium text-foreground hover:bg-muted/55"
				disabled={disabled}
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
			>
				<span className="flex items-center gap-1.5">
					<span className="icon-[lucide--library] block size-3.5 text-muted-foreground" aria-hidden="true" />
					{t("nodeEditor.reference.fromAssets")}
				</span>
				<span className="text-[10px] text-muted-foreground">{options.length}</span>
			</button>
			{open ? (
				<div className="mt-1.5 rounded-xl border border-border/70 bg-popover p-1.5 shadow-sm">
					<input
						className="mb-1.5 h-8 w-full rounded-lg border border-border/70 bg-background px-2.5 text-[11px] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50"
						value={query}
						placeholder={t("nodeEditor.reference.searchAssets")}
						onChange={(event) => {
							setQuery(event.target.value);
							setVisibleCount(PAGE_SIZE);
						}}
					/>
					<div className="max-h-52 overflow-y-auto">
						{filteredOptions.slice(0, visibleCount).map((option) => (
							<button
								type="button"
								key={`${option.sourceNodeId}:${option.asset.id}`}
								className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-45"
								disabled={disabled || !option.slotId}
								title={t(option.slotId ? "nodeEditor.reference.selectAsset" : "nodeEditor.reference.assetUnsupported")}
								onClick={() => onSelect(option)}
							>
								<ContentAssetThumbnail
									asset={option.asset}
									className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted object-cover text-muted-foreground"
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<strong className="truncate text-[11px] font-medium">{option.asset.name}</strong>
									<span className="text-[10px] text-muted-foreground">
										{t(`asset.kind.${option.asset.kind}`)}
										{option.slotId ? "" : ` · ${t("nodeEditor.reference.assetUnsupported")}`}
									</span>
								</span>
							</button>
						))}
						{filteredOptions.length === 0 ? (
							<p className="m-0 px-2 py-4 text-center text-[11px] text-muted-foreground">
								{t("nodeEditor.reference.noAssets")}
							</p>
						) : null}
						{visibleCount < filteredOptions.length ? (
							<button
								type="button"
								className="mt-1 w-full rounded-lg py-1.5 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
								onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
							>
								{t("assetNode.showMore", { count: filteredOptions.length - visibleCount })}
							</button>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
