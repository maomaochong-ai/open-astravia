import { Button } from "@vetta-org/ui";
import { memo, useEffect, useState } from "react";
import { CodeBlock } from "./CodeBlock";
import type { MarkdownCodeBlockProps } from "./definition";
import { useMarkdownHost } from "./host";
import { MarkdownImage } from "./MarkdownImage";
import { svgImageSource } from "./preview-policy";
import { defaultRichContentLabels } from "./rich-labels";
import { useRichVisibility } from "./use-rich-visibility";

export const MermaidBlock = memo(function MermaidBlock(props: MarkdownCodeBlockProps) {
	const { code, theme, live } = props;
	const host = useMarkdownHost();
	const labels = props.labels.rich ?? defaultRichContentLabels;
	const { ref, active } = useRichVisibility<HTMLDivElement>();
	const [source, setSource] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [result, setResult] = useState<{ key: string; svg: string | null }>();
	const key = `${theme}:${code}`;
	const oversized = code.length > 12_000;
	useEffect(() => {
		if (!host || !active || live || source || oversized) return;
		let cancelled = false;
		void host.renderMermaid(code, theme).then(
			(svg) => { if (!cancelled) setResult({ key, svg }); },
			() => { if (!cancelled) setResult({ key, svg: null }); },
		);
		return () => { cancelled = true; };
	}, [host, active, live, source, oversized, key, code, theme, attempt]);
	const current = result?.key === key ? result : undefined;
	const image = current?.svg ? svgImageSource(current.svg) : null;
	return <CodeBlock.Root {...props}><CodeBlock.Copy><CodeBlock.Frame><div ref={ref}>
		<div className="flex items-center gap-2 border-b border-border px-3 py-1 pr-12">
			<span className="text-[12px] text-muted-foreground">Mermaid</span>
			<Button variant="ghost" size="sm" aria-pressed={source} onClick={() => setSource(!source)}>{source ? labels.preview : labels.source}</Button>
			{current?.svg === null && <Button variant="ghost" size="sm" onClick={() => { setResult(undefined); setAttempt((value) => value + 1); }}>{labels.retry ?? "Retry"}</Button>}
		</div>
		{source || live || oversized || !host || current?.svg === null ? <>
			{!source && <p role="status" className="px-3 py-2 text-[12px] text-muted-foreground">{oversized ? labels.tooLarge : live ? labels.waiting : labels.failed}</p>}
			<CodeBlock.Content />
		</> : image ? <div className="p-3"><MarkdownImage src={image} alt={labels.diagram ?? "Diagram"} labels={props.labels} /></div> : <div className="min-h-24 p-3" role="status">{labels.loading ?? labels.waiting}</div>}
	</div></CodeBlock.Frame></CodeBlock.Copy></CodeBlock.Root>;
});
