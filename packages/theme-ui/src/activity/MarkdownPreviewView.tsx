import { memo, useEffect, useMemo, useState, type JSX, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlockCopyButtonView } from "../shared/CodeBlockCopyButton";
import { SyntaxHighlightedCode } from "../shared/SyntaxHighlightedCode";

export interface MarkdownPreviewViewProps {
	content: string;
	theme: "light" | "dark";
	/** Host opens http(s)/mailto/tel links (e.g. via shell.openExternal). */
	onOpenExternal: (href: string) => void;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

type FrontmatterEntry = { key: string; value: string; depth: number };

function parseFrontmatter(raw: string): { entries: FrontmatterEntry[]; body: string } | null {
	const match = raw.match(FRONTMATTER_RE);
	if (!match) return null;
	const block = match[1] ?? "";
	const entries: FrontmatterEntry[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		const depth = Math.floor(indent / 2);
		const rest = line.slice(indent);
		const colon = rest.indexOf(":");
		if (colon === -1) {
			entries.push({ key: "", value: rest.trim(), depth });
			continue;
		}
		const key = rest.slice(0, colon).trim();
		const value = rest
			.slice(colon + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		entries.push({ key, value, depth });
	}
	return { entries, body: raw.slice(match[0].length) };
}

function Frontmatter({ entries }: { entries: FrontmatterEntry[] }): JSX.Element {
	return (
		<div className="mb-4 overflow-hidden rounded-lg border border-border bg-muted/40">
			<div className="border-b border-border/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
				Frontmatter
			</div>
			<div className="px-3 py-2">
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] leading-[1.6]">
					{entries.map((entry, i) => (
						<div key={i} className="contents">
							<dt
								className="font-medium text-muted-foreground"
								style={{ paddingLeft: `${entry.depth * 12}px` }}
							>
								{entry.key || "-"}
							</dt>
							<dd className="break-words text-foreground">
								{entry.value || <span className="text-muted-foreground/40">—</span>}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</div>
	);
}

const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

function isExternalLink(href: string | undefined): href is string {
	if (!href) return false;
	try {
		return EXTERNAL_LINK_PROTOCOLS.has(new URL(href).protocol);
	} catch {
		return false;
	}
}

function MarkdownCodeBlock({
	lang,
	code,
	theme,
}: {
	lang: string;
	code: string;
	theme: "light" | "dark";
}): JSX.Element {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const id = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(id);
	}, [copied]);

	return (
		<CodeBlockCopyButtonView
			copied={copied}
			onCopy={() => {
				void navigator.clipboard.writeText(code).then(() => setCopied(true));
			}}
			labels={{ copy: "Copy code", copied: "Copied" }}
		>
			<div className="my-2 overflow-hidden rounded-lg border border-border bg-muted">
				{lang && (
					<div className="border-b border-border px-3 py-1 text-[10px] font-medium text-muted-foreground/50">
						{lang}
					</div>
				)}
				<SyntaxHighlightedCode code={code} lang={lang} theme={theme} />
			</div>
		</CodeBlockCopyButtonView>
	);
}

export const MarkdownPreviewView = memo(function MarkdownPreviewView({
	content,
	theme,
	onOpenExternal,
}: MarkdownPreviewViewProps): JSX.Element {
	const parsed = parseFrontmatter(content);
	const body = parsed?.body ?? content;

	const components = useMemo<Components>(() => {
		const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>, href: string | undefined) => {
			if (!isExternalLink(href)) return;
			event.preventDefault();
			onOpenExternal(href);
		};

		return {
			h1: ({ children }) => (
				<h1 className="mb-3 mt-4 text-[18px] font-bold leading-tight text-foreground">{children}</h1>
			),
			h2: ({ children }) => (
				<h2 className="mb-2 mt-3.5 text-[16px] font-bold leading-tight text-foreground">{children}</h2>
			),
			h3: ({ children }) => (
				<h3 className="mb-2 mt-3 text-[14px] font-semibold leading-tight text-foreground">{children}</h3>
			),
			h4: ({ children }) => (
				<h4 className="mb-1.5 mt-2.5 text-[13px] font-semibold text-foreground">{children}</h4>
			),
			p: ({ children }) => <p className="my-1.5 text-[13px] leading-[1.6] text-foreground">{children}</p>,
			ul: ({ children }) => (
				<ul className="md-bullet-list my-1.5 text-[13px] leading-[1.6] text-foreground">{children}</ul>
			),
			ol: ({ children }) => (
				<ol className="my-1.5 ml-4 list-decimal space-y-0.5 text-[13px] leading-[1.6] text-foreground marker:text-primary">
					{children}
				</ol>
			),
			li: ({ children }) => <li>{children}</li>,
			code: ({ className, children }) => {
				const raw = String(children);
				const isBlock = (className?.startsWith("language-") ?? false) || raw.includes("\n");
				if (isBlock) {
					const lang = className?.replace("language-", "") ?? "";
					const code = raw.replace(/\n$/, "");
					return <MarkdownCodeBlock lang={lang} code={code} theme={theme} />;
				}
				return <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground">{children}</code>;
			},
			pre: ({ children }) => <>{children}</>,
			blockquote: ({ children }) => (
				<blockquote className="my-2 border-l-2 border-primary/10 pl-3 text-[13px] italic text-muted-foreground">
					{children}
				</blockquote>
			),
			table: ({ children }) => (
				<div className="my-2 overflow-x-auto rounded-lg border border-border">
					<table className="w-full text-[12px]">{children}</table>
				</div>
			),
			thead: ({ children }) => <thead className="border-b border-border bg-muted">{children}</thead>,
			th: ({ children }) => (
				<th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">{children}</th>
			),
			td: ({ children }) => (
				<td className="border-t border-border px-3 py-1.5 text-foreground">{children}</td>
			),
			hr: () => <hr className="my-3 border-border" />,
			a: ({ href, children }) => (
				<a
					href={href}
					className="text-primary underline decoration-primary/30 hover:decoration-primary"
					target={isExternalLink(href) ? "_blank" : undefined}
					rel={isExternalLink(href) ? "noopener noreferrer" : undefined}
					onClick={(event) => handleLinkClick(event, href)}
				>
					{children}
				</a>
			),
			strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
			em: ({ children }) => <em className="italic">{children}</em>,
		};
	}, [theme, onOpenExternal]);

	return (
		<div className="markdown-body break-words p-4">
			{parsed && parsed.entries.length > 0 && <Frontmatter entries={parsed.entries} />}
			<ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={components}>
				{body}
			</ReactMarkdown>
		</div>
	);
});
