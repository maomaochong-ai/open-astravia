import type { ContentAsset } from "../project/types";
import { useState } from "react";
import { ContentAssetKindIcon } from "./ContentAssetKindIcon";

interface ContentAssetThumbnailProps {
	asset: ContentAsset;
	className?: string;
}

export function ContentAssetThumbnail({ asset, className }: ContentAssetThumbnailProps) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	if (asset.kind === "image" && asset.previewUrl && failedUrl !== asset.previewUrl) {
		return (
			<img
				className={className}
				src={asset.previewUrl}
				alt={asset.name}
				loading="lazy"
				decoding="async"
				draggable={false}
				onError={() => setFailedUrl(asset.previewUrl ?? null)}
			/>
		);
	}
	return (
		<div className={className} title={asset.name}>
			<ContentAssetKindIcon kind={asset.kind} className="block size-1/3 min-h-5 min-w-5" />
		</div>
	);
}
