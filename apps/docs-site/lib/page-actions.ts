export interface PageActionLink {
	id: "markdown" | "scira" | "chatgpt" | "claude" | "cursor";
	href: string;
	label: string;
	external: boolean;
}

export type PageActionLanguage = "zh" | "en";

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

	return [
		{
			id: "markdown",
			href: input.markdownUrl,
			label: language === "en" ? "View Markdown" : "查看 Markdown",
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
