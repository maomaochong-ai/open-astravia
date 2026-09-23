import { Button } from "@vetta-org/ui";
import { memo, useEffect, useMemo, useState } from "react";
import { CodeBlock } from "./CodeBlock";
import type { MarkdownCodeBlockProps } from "./definition";
import { createPreviewDocument, MARKDOWN_PREVIEW_FRAME_NAME, MAX_PREVIEW_LENGTH } from "./preview-policy";
import { defaultRichContentLabels } from "./rich-labels";
import { SvgPreview } from "./SvgPreview";
import { useRichVisibility } from "./use-rich-visibility";

/** Product recipe; source/copy retain the existing CodeBlock primitives. */
export const RichCodeBlock = memo(function RichCodeBlock(props: MarkdownCodeBlockProps) {
	const { code, lang, live = false } = props;
	const labels = props.labels.rich ?? defaultRichContentLabels;
	const svg = lang.toLowerCase() === "svg";
	const { ref, active } = useRichVisibility<HTMLDivElement>();
	const [showSource, setShowSource] = useState(false);
	const [runSource, setRunSource] = useState<string | null>(null);
	const [paused, setPaused] = useState(false);
	const oversized = code.length > MAX_PREVIEW_LENGTH;
	const running = runSource === code && active && !live && !showSource;
	useEffect(() => {
		if (!active || live || showSource || (runSource !== null && runSource !== code)) {
			if (runSource !== null) setPaused(true);
			setRunSource(null);
		}
	}, [active, live, showSource, code, runSource]);
	useEffect(() => {
		if (!running) return;
		// Cooperative previews get a bounded lifetime; this is not a CPU sandbox for synchronous infinite loops.
		const timeout = setTimeout(() => {
			setRunSource(null);
			setPaused(true);
		}, 30_000);
		return () => clearTimeout(timeout);
	}, [running]);
	const srcDoc = useMemo(
		() => (active && !svg && !live && !oversized && !showSource ? createPreviewDocument(code, running) : ""),
		[active, svg, live, oversized, showSource, code, running],
	);
	return (
		<CodeBlock.Root {...props}>
			<CodeBlock.Copy>
				<CodeBlock.Frame>
					<div ref={ref}>
						<div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1 pr-12">
							<span className="text-[12px] text-muted-foreground">{svg ? "SVG" : "HTML"}</span>
							<Button variant="ghost" size="sm" aria-pressed={showSource} onClick={() => setShowSource(!showSource)}>
								{showSource ? labels.preview : labels.source}
							</Button>
							{!svg && !showSource && !live && !oversized && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setPaused(running);
										setRunSource(running ? null : code);
									}}
								>
									{running ? labels.stop : labels.run}
								</Button>
							)}
						</div>
						{live || oversized || showSource ? (
							<>
								{!showSource && (
									<p className="px-3 py-2 text-[12px] text-muted-foreground">
										{oversized ? labels.tooLarge : labels.waiting}
									</p>
								)}
								{oversized ? (
									<pre className="max-h-96 overflow-auto p-3 text-[13px]">
										<code>{code}</code>
									</pre>
								) : (
									<CodeBlock.Content />
								)}
							</>
						) : svg ? (
							<div className="p-3">
								<SvgPreview source={code} label={labels.svg} failed={labels.failed} />
							</div>
						) : (
							<>
								<p className="px-3 py-2 text-[12px] text-muted-foreground">
									{running ? labels.running : paused ? labels.paused : labels.staticHtml}
								</p>
								{srcDoc ? (
									<iframe
										key={running ? "running" : "static"}
										name={MARKDOWN_PREVIEW_FRAME_NAME}
										title={labels.html}
										srcDoc={srcDoc}
										sandbox={running ? "allow-scripts" : ""}
										referrerPolicy="no-referrer"
										allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
										className="h-80 w-full border-0 bg-background"
									/>
								) : (
									<div className="h-80" aria-hidden="true" />
								)}
							</>
						)}
					</div>
				</CodeBlock.Frame>
			</CodeBlock.Copy>
		</CodeBlock.Root>
	);
});
