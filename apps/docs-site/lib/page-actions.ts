import { getDocsMessages, type DocsLanguage } from "./i18n";

export interface PageActionLink {
	id: "markdown" | "scira" | "chatgpt" | "claude" | "cursor";
	href: string;
	label: string;
	external: boolean;
}

export type PageActionLanguage = DocsLanguage;

export function buildAskPrompt(pageUrl: string): string {
	return `Read ${pageUrl}, I want to ask questions about it.`;
}

export function buildPageActionLinks(input: {
	pageUrl: string;
	markdownUrl: string;
	language?: PageActionLanguage;
}): PageActionLink[] {
	const prompt = buildAskPrompt(input.pageUrl);
	const language = input.language ?? "zh";
	const text = getDocsMessages(language);

	return [
		{
			id: "markdown",
			href: input.markdownUrl,
			label: text.viewMarkdown,
			external: false,
		},
		{
			id: "scira",
			href: `https://scira.ai/?${new URLSearchParams({ q: prompt })}`,
			label: "Scira AI",
			external: true,
		},
		{
			id: "chatgpt",
			href: `https://chatgpt.com/?${new URLSearchParams({ prompt, hints: "search" })}`,
			label: "ChatGPT",
			external: true,
		},
		{
			id: "claude",
			href: `https://claude.ai/new?${new URLSearchParams({ q: prompt })}`,
			label: "Claude",
			external: true,
		},
		{
			id: "cursor",
			href: `https://cursor.com/link/prompt?${new URLSearchParams({ text: prompt })}`,
			label: "Cursor",
			external: true,
		},
	];
}
