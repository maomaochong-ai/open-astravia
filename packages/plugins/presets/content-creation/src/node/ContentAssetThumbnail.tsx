import type { ContentAsset } from "../project/types";

interface ContentAssetThumbnailProps {
	asset: ContentAsset;
	className?: string;
}

export function ContentAssetThumbnail({ asset, className }: ContentAssetThumbnailProps) {
	if (asset.kind === "image") {
		return (
			<img
				className={className}
				src={asset.url}
				alt={asset.name}
				loading="lazy"
				decoding="async"
				draggable={false}
			/>
		);
	}
	if (asset.kind === "video") {
		return (
			<div className={className} title={asset.name}>
				<span className="icon-[lucide--clapperboard] block size-1/3 min-h-5 min-w-5" aria-hidden="true" />
			</div>
		);
	}
	return (
		<div className={className} title={asset.name}>
			<span className="icon-[lucide--audio-lines] block size-1/3 min-h-5 min-w-5" aria-hidden="true" />
		</div>
	);
}
