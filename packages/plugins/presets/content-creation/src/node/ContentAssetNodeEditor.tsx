import { useTranslation } from "@vetta-org/plugin-sdk";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import type { ImportedContentAsset } from "../generation/types";
import type { ContentAsset, ContentNodeData } from "../project/types";
import { ContentAssetThumbnail } from "./ContentAssetThumbnail";
import { listContentNodeAssetIds } from "./material-assets";
import { NodeEditorPanel } from "./NodeEditorPanel";
import { createImportedMediaFile } from "./imported-media-file";

const PAGE_SIZE = 24;
const IMPORT_BATCH_SIZE = 4;

interface ContentAssetNodeEditorProps {
	name: string;
	data: ContentNodeData;
	assets: readonly ContentAsset[];
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onRename: (name: string) => Promise<void>;
	onImport: (files: readonly ImportedContentAsset[]) => Promise<void>;
}

export function ContentAssetNodeEditor({ name, data, assets, onUpdate, onRename, onImport }: ContentAssetNodeEditorProps) {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const [nameDraft, setNameDraft] = useState(name);
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const [importing, setImporting] = useState(false);

	useEffect(() => setNameDraft(name), [name]);
	useEffect(() => setVisibleCount(PAGE_SIZE), [assets.length]);

	const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (files.length === 0) return;
		setImporting(true);
		try {
			for (let index = 0; index < files.length; index += IMPORT_BATCH_SIZE) {
				const batch = files.slice(index, index + IMPORT_BATCH_SIZE);
				await onImport(await Promise.all(batch.map((file) => createImportedMediaFile(file))));
			}
		} finally {
			setImporting(false);
		}
	};
	const removeAsset = (assetId: string) => {
		const assetIds = listContentNodeAssetIds(data).filter((candidate) => candidate !== assetId);
		void onUpdate({
			...data,
			assetId: data.assetId === assetId ? undefined : data.assetId,
			assetIds,
		});
	};

	return (
		<NodeEditorPanel className="w-[min(440px,calc(100vw-32px))] rounded-2xl border border-border/70 bg-card/95 p-3 text-card-foreground shadow-xl backdrop-blur-md">
			<div className="flex items-center gap-2">
				<input
					className="min-w-0 flex-1 rounded-lg border border-border/70 bg-background/60 px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:border-primary/50"
					value={nameDraft}
					placeholder={t("nodeEditor.label")}
					onChange={(event) => setNameDraft(event.target.value)}
					onBlur={() => void onRename(nameDraft)}
				/>
				<button
					type="button"
					className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-wait disabled:opacity-60"
					disabled={importing}
					onClick={() => inputRef.current?.click()}
				>
					<span className="icon-[lucide--upload] block size-3.5" aria-hidden="true" />
					{t(importing ? "assetNode.importing" : "assetNode.import")}
				</button>
				<input
					ref={inputRef}
					className="hidden"
					type="file"
					multiple
					accept="image/*,video/*,audio/*"
					disabled={importing}
					onChange={(event) => void handleFiles(event)}
				/>
			</div>
			<div className="mt-2 flex items-center justify-between px-0.5 text-[10px] text-muted-foreground">
				<span>{t("assetNode.total", { count: assets.length })}</span>
				<span>{t("assetNode.performanceHint")}</span>
			</div>
			{assets.length > 0 ? (
				<div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border/60 bg-background/35 p-1">
					{assets.slice(0, visibleCount).map((asset) => (
						<div
							key={asset.id}
							className="group flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/60"
						>
							<ContentAssetThumbnail
								asset={asset}
								className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted object-cover text-muted-foreground"
							/>
							<span className="flex min-w-0 flex-1 flex-col">
								<strong className="truncate text-[11px] font-medium">{asset.name}</strong>
								<span className="text-[10px] text-muted-foreground">{t(`asset.kind.${asset.kind}`)}</span>
							</span>
							<button
								type="button"
								className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
								disabled={importing}
								title={t("assetNode.remove")}
								aria-label={t("assetNode.remove")}
								onClick={() => removeAsset(asset.id)}
							>
								<span className="icon-[lucide--x] block size-3.5" aria-hidden="true" />
							</button>
						</div>
					))}
					{visibleCount < assets.length ? (
						<button
							type="button"
							className="mt-1 w-full rounded-lg py-1.5 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
							onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
						>
							{t("assetNode.showMore", { count: assets.length - visibleCount })}
						</button>
					) : null}
				</div>
			) : (
				<p className="mb-0 mt-3 rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
					{t("assetNode.empty.description")}
				</p>
			)}
		</NodeEditorPanel>
	);
}
