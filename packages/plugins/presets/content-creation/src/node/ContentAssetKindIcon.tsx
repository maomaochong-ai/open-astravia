import type { AssetKind } from "../project/types";

interface ContentAssetKindIconProps {
	kind: AssetKind;
	className?: string;
}

export function ContentAssetKindIcon({ kind, className }: ContentAssetKindIconProps) {
	if (kind === "image") {
		return <span className={`icon-[lucide--image] block ${className ?? ""}`} aria-hidden="true" />;
	}
	if (kind === "video") {
		return <span className={`icon-[lucide--video] block ${className ?? ""}`} aria-hidden="true" />;
	}
	return <span className={`icon-[lucide--audio-lines] block ${className ?? ""}`} aria-hidden="true" />;
}
