import { useEffect, useState, type JSX } from "react";
import { codeToHtml } from "shiki";
import { getTextEditorLanguageId } from "../file-preview/text-editor-language";

export interface CodePreviewProps {
	content: string;
	extension: string;
	theme: "light" | "dark";
}

export function CodePreview({ content, extension, theme }: CodePreviewProps): JSX.Element {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const lang = getTextEditorLanguageId(extension);

		codeToHtml(content, {
			lang,
			theme: theme === "dark" ? "github-dark-default" : "github-light-default",
		})
			.then((result) => {
				if (!cancelled) setHtml(result);
			})
			.catch(() => {
				if (!cancelled) setHtml("");
			});

		return () => {
			cancelled = true;
		};
	}, [content, extension, theme]);

	if (html === null) {
		return (
			<div className="flex items-center justify-center p-8">
				<span className="icon-[mdi--loading] animate-spin text-[24px] text-muted-foreground/50" />
			</div>
		);
	}

	if (html === "") {
		return (
			<pre className="text-preview-content whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-[1.6] text-foreground">
				{content}
			</pre>
		);
	}

	return (
		<div
			className="code-preview overflow-x-auto p-4 text-[12px] leading-[1.6] [&_pre]:!bg-transparent [&_code]:!bg-transparent"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki generates safe HTML
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
