import { Button } from "@vetta-org/ui";
import type { MarkdownLabels } from "./rich-labels";
import { memo, useEffect, useRef, useState } from "react";
import { requestFormula } from "./math-client";
import { useRichVisibility } from "./use-rich-visibility";
import { useRenderSnapshot } from "./use-render-snapshot";
import "katex/dist/katex.min.css";

export const MathFormula = memo(function MathFormula({
	source,
	display,
	live = false,
	labels,
}: {
	source: string;
	display: boolean;
	live?: boolean;
	labels?: MarkdownLabels;
}) {
	const { ref, active } = useRichVisibility();
	const currentSource = useRef(source);
	currentSource.current = source;
	const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
	useEffect(() => setCopyState(null), [source]);
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
			{labels && <Button variant="ghost" size="icon-xs" title={copyState === "copied" ? labels.copied : labels.copy} aria-label={copyState === "copied" ? labels.copied : labels.copy} onClick={() => {
				void navigator.clipboard.writeText(source).then(() => { if (currentSource.current === source) setCopyState("copied"); }, () => { if (currentSource.current === source) setCopyState("failed"); });
			}}><span aria-hidden="true" className={copyState === "copied" ? "icon-[solar--check-circle-linear]" : "icon-[solar--copy-linear]"} /></Button>}
			{copyState === "failed" && <span role="status">{labels?.rich?.actionFailed}</span>}
		</span>
	);
});
