import { Button } from "@vetta-org/ui";
import { memo, useEffect, useRef, useState } from "react";
import { useMarkdownHost } from "./host";
import type { MarkdownLabels } from "./rich-labels";
import { defaultRichContentLabels } from "./rich-labels";
import { useRichVisibility } from "./use-rich-visibility";

export const MarkdownImage = memo(function MarkdownImage({ src = "", alt = "", title, labels }: { src?: string; alt?: string; title?: string; labels: MarkdownLabels }) {
	const host = useMarkdownHost();
	const rich = labels.rich ?? defaultRichContentLabels;
	const { ref, active } = useRichVisibility();
	const [attempt, setAttempt] = useState(0);
	const [result, setResult] = useState<{ source: string; url: string }>();
	const [failed, setFailed] = useState(false);
	const [action, setAction] = useState<"copy" | "save" | "failed" | "copied" | null>(null);
	const generation = useRef(0);
	useEffect(() => () => { generation.current++; }, [src]);
	useEffect(() => {
		if (!active || !src) return;
		let cancelled = false;
		setFailed(false);
		setAction(null);
		const request = host ? host.resolveImage(src) : Promise.resolve(src);
		void request.then((url) => { if (!cancelled) setResult({ source: src, url }); }, () => { if (!cancelled) setFailed(true); });
		return () => { cancelled = true; };
	}, [active, host, src, attempt]);
	const url = result?.source === src ? result.url : undefined;
	const run = async (kind: "copy" | "save") => {
		if (!host || !url) return;
		const current = generation.current;
		setAction(kind);
		try {
			await (kind === "copy" ? host.copyImage(url) : host.saveImage(url));
			if (current === generation.current) setAction(kind === "copy" ? "copied" : null);
		} catch { if (current === generation.current) setAction("failed"); }
	};
	return <span ref={ref} className="my-2 inline-flex max-w-full flex-col gap-1 align-top">
		{failed ? <span role="status">{rich.imageFailed ?? rich.failed} {alt}</span> : url ? (
			<img key={`${url}:${attempt}`} src={url} alt={alt} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-h-96 max-w-full rounded object-contain" onError={() => setFailed(true)} />
		) : <span className="min-h-16" aria-busy="true">{alt}</span>}
		<span className="flex flex-wrap items-center gap-1">
			{failed && <Button variant="ghost" size="sm" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setFailed(false); setAttempt((value) => value + 1); }}>{rich.retry ?? "Retry"}</Button>}
			{host && url && !failed && <>
				<Button variant="ghost" size="sm" onClick={(event) => { event.preventDefault(); event.stopPropagation(); host.openImage(url, alt); }}>{rich.enlarge ?? "Enlarge"}</Button>
				<Button variant="ghost" size="sm" disabled={action === "copy" || action === "save"} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void run("copy"); }}>{action === "copied" ? labels.copied : labels.copy}</Button>
				<Button variant="ghost" size="sm" disabled={action === "copy" || action === "save"} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void run("save"); }}>{rich.save ?? "Save"}</Button>
			</>}
		</span>
		{action === "failed" && <span role="status">{rich.actionFailed ?? rich.failed}</span>}
	</span>;
});
