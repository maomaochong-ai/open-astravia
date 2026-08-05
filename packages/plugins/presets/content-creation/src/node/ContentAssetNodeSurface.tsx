import { useTranslation } from "@vetta-org/plugin-sdk";
import type { AssetKind, ContentAsset } from "../project/types";
import { ContentAssetThumbnail } from "./ContentAssetThumbnail";
import { NodeKindIcon } from "./NodeKindIcon";

interface ContentAssetNodeSurfaceProps {
	assets: readonly ContentAsset[];
}

const PREVIEW_LIMIT = 3;
const ASSET_KINDS: readonly AssetKind[] = ["image", "video", "audio"];

export function ContentAssetNodeSurface({ assets }: ContentAssetNodeSurfaceProps) {
	const { t } = useTranslation();
	const previews = assets.slice(0, PREVIEW_LIMIT);

	if (assets.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center text-muted-foreground">
				<span className="grid size-14 place-items-center rounded-2xl border border-dashed border-border/80 bg-background/40">
					<NodeKindIcon kind="asset" className="size-7 opacity-60" />
				</span>
				<div className="flex flex-col gap-1">
					<strong className="text-sm font-medium text-foreground">{t("assetNode.empty.title")}</strong>
					<span className="text-xs leading-relaxed">{t("assetNode.empty.description")}</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col justify-between overflow-hidden bg-muted/25 p-[clamp(12px,4cqmin,20px)] [container-type:size]">
			<div className="relative mx-auto min-h-0 w-[62%] flex-1">
				{previews.map((asset, index) => (
					<div
						key={asset.id}
						className="absolute inset-[8%] overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm"
						style={{
							transform: `translate(${index * 7 - 7}%, ${index * 5 - 5}%) rotate(${(index - 1) * 2.5}deg)`,
							zIndex: index + 1,
						}}
					>
						<ContentAssetThumbnail
							asset={asset}
							className="flex h-full w-full items-center justify-center bg-muted object-cover text-muted-foreground"
						/>
					</div>
				))}
				{assets.length > PREVIEW_LIMIT ? (
					<span className="absolute right-0 bottom-0 z-10 rounded-full border border-border bg-popover px-2 py-0.5 text-[10px] font-semibold text-popover-foreground shadow-sm">
						{t("assetNode.more", { count: assets.length - PREVIEW_LIMIT })}
					</span>
				) : null}
			</div>
			<div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
				{ASSET_KINDS.map((kind) => {
					const count = assets.filter((asset) => asset.kind === kind).length;
					if (count === 0) return null;
					return (
						<span
							key={kind}
							className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
						>
							{t(`asset.kind.${kind}`)} {count}
						</span>
					);
				})}
			</div>
		</div>
	);
}
