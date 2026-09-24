import { memo, useMemo, useState } from "react";
import { MAX_PREVIEW_LENGTH, svgImageSource } from "./preview-policy";
import { useRichVisibility } from "./use-rich-visibility";
import { useRenderSnapshot } from "./use-render-snapshot";

export const SvgPreview = memo(function SvgPreview({
	source,
	live = false,
	label,
	failed,
}: {
	source: string;
	live?: boolean;
	label: string;
	failed: string;
}) {
	const { ref, active } = useRichVisibility();
	const snapshot = useRenderSnapshot(source, active, live, 500);
	const src = useMemo(() => (active ? svgImageSource(snapshot) : null), [snapshot, active]);
	const [failedSource, setFailedSource] = useState<string | null>(null);
	const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined);
	return (
		<span ref={ref} className="inline-block max-w-full align-middle" style={!active ? size : undefined}>
			{source.length > MAX_PREVIEW_LENGTH || failedSource === snapshot || (active && src === null) ? (
				<span>
					<span className="text-muted-foreground">{failed}</span>
					<code>{source}</code>
				</span>
			) : src ? (
				<img
					src={src}
					alt={label}
					className="max-h-96 max-w-full"
					onError={() => setFailedSource(snapshot)}
					onLoad={(event) => {
						const { width, height } = event.currentTarget.getBoundingClientRect();
						setSize({ width, height });
					}}
				/>
			) : (
				<span className="text-muted-foreground">{label}</span>
			)}
		</span>
	);
});
