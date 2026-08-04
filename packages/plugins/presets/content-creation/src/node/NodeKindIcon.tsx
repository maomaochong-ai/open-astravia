import type { CSSProperties } from "react";
import type { ContentNodeKind } from "../project/types";

interface NodeKindIconProps {
	kind: ContentNodeKind;
	className?: string;
	style?: CSSProperties;
}

const NODE_KIND_ICON_CLASS: Record<ContentNodeKind, string> = {
	prompt: "icon-[lucide--message-circle]",
	"image-generator": "icon-[lucide--image]",
	"video-generator": "icon-[lucide--clapperboard]",
	asset: "icon-[lucide--folder-open]",
	output: "icon-[lucide--external-link]",
};

export function NodeKindIcon({ kind, className, style }: NodeKindIconProps) {
	return (
		<span
			className={`${NODE_KIND_ICON_CLASS[kind]} block shrink-0 ${className ?? "size-4"}`}
			style={style}
			aria-hidden="true"
		/>
	);
}
