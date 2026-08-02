import type { ContentNodeKind } from "../project/types";

interface NodeKindIconProps {
	kind: ContentNodeKind;
	className?: string;
}

const stroke = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.7,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

export function NodeKindIcon({ kind, className }: NodeKindIconProps) {
	if (kind === "prompt") {
		return (
			<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
				<path d="M5 4h14v12H9l-4 4V4Z" />
				<path d="M8 8h8M8 12h5" />
			</svg>
		);
	}
	if (kind === "image-generator") {
		return (
			<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
				<rect x="3" y="5" width="18" height="14" rx="2" />
				<path d="m5.5 16 4-4 3 3 2-2 4 3.5M16.5 8.5h.01" />
			</svg>
		);
	}
	if (kind === "video-generator") {
		return (
			<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
				<rect x="3" y="5" width="14" height="14" rx="2" />
				<path d="m17 10 4-2v8l-4-2M8.5 9.5l4 2.5-4 2.5v-5Z" />
			</svg>
		);
	}
	if (kind === "asset") {
		return (
			<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
				<path d="M3 7h7l2 2h9v10H3V7Z" />
				<path d="M3 7V5h6l2 2" />
			</svg>
		);
	}
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
			<path d="M4 4h16v16H4zM8 12h8M13 8l4 4-4 4" />
		</svg>
	);
}
