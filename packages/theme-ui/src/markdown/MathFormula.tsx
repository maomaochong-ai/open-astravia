import { memo, useEffect, useState } from "react";
import { requestFormula } from "./math-client";
import { useRichVisibility } from "./use-rich-visibility";
import { useRenderSnapshot } from "./use-render-snapshot";
import "katex/dist/katex.min.css";

export const MathFormula = memo(function MathFormula({
	source,
	display,
	live = false,
}: {
	source: string;
	display: boolean;
	live?: boolean;
}) {
	const { ref, active } = useRichVisibility();
	const snapshot = useRenderSnapshot(source, active, live);
	const [result, setResult] = useState<{ source: string; html: string | null } | null>(null);
	useEffect(() => {
		if (!active) return;
		return requestFormula(snapshot, display, (html) => setResult({ source: snapshot, html }));
	}, [active, display, snapshot]);
	const html = result?.source === snapshot ? result.html : null;
	return (
		<span ref={ref} className={display ? "my-2 block max-w-full overflow-x-auto" : undefined}>
			{html ? (
				// biome-ignore lint/security/noDangerouslySetInnerHtml: only bounded KaTeX output with trust:false, never raw model HTML
				<span dangerouslySetInnerHTML={{ __html: html }} />
			) : (
				<code>{source}</code>
			)}
		</span>
	);
});
