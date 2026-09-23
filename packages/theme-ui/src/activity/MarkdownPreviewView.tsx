import { chatUrlTransform } from "../markdown/markdown-link";
import { MarkdownHostProvider } from "../markdown/host";
import type { MarkdownHost } from "../markdown/host";
import { MarkdownImage } from "../markdown/MarkdownImage";
import { memo, useMemo, type JSX, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	MarkdownTable,
	MarkdownTableBody,
	MarkdownTableCell,
	MarkdownTableHead,
	MarkdownTableHeaderCell,
	MarkdownTableRow,
} from "../shared/MarkdownTable";
import { useMarkdownDefinition } from "../markdown/definition";
import { BuiltinCodeBlock, Formula } from "../markdown/builtin-renderers";
import { richRemarkPlugins } from "../markdown/rich-syntax";
import { SvgPreview } from "../markdown/SvgPreview";
import { WebsiteIcon } from "../markdown/WebsiteIcon";
import { defaultRichContentLabels } from "../markdown/rich-labels";
import type { MarkdownLabels } from "../markdown/rich-labels";
import type { HastElement } from "../markdown/nodes";

export interface MarkdownPreviewViewProps {
	host?: MarkdownHost;
	content: string;
	theme: "light" | "dark";
	/** Host opens http(s)/mailto/tel links (e.g. via shell.openExternal). */
	onOpenExternal: (href: string) => void;
	labels?: MarkdownLabels;
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
							<dt className="font-medium text-muted-foreground" style={{ paddingLeft: `${entry.depth * 12}px` }}>
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
const MARKDOWN_REMARK_PLUGINS = [remarkGfm, ...richRemarkPlugins];
const DEFAULT_LABELS: MarkdownLabels = { copy: "Copy code", copied: "Copied" };

function isExternalLink(href: string | undefined): href is string {
	if (!href) return false;
	try {
		return EXTERNAL_LINK_PROTOCOLS.has(new URL(href).protocol);
	} catch {
		return false;
	}
}

export const MarkdownPreviewView = memo(function MarkdownPreviewView({
	content,
	theme,
	onOpenExternal,
	labels = DEFAULT_LABELS,
	host,
}: MarkdownPreviewViewProps): JSX.Element {
	const definition = useMarkdownDefinition();
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
			h4: ({ children }) => <h4 className="mb-1.5 mt-2.5 text-[13px] font-semibold text-foreground">{children}</h4>,
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
			img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} labels={labels} />,
			code: ({ className, children }) => {
				const raw = String(children);
				if (className?.includes("math-inline") || className?.includes("math-display")) {
					return <Formula source={raw.replace(/\n$/, "")} display={className.includes("math-display")} labels={labels} />;
				}
				const isBlock = (className?.startsWith("language-") ?? false) || raw.includes("\n");
				if (isBlock) {
					const lang = className?.replace("language-", "") ?? "";
					const code = raw.replace(/\n$/, "");
					const CodeBlock = definition.codeBlock ?? BuiltinCodeBlock;
					return (
						<CodeBlock lang={lang} code={code} theme={theme} labels={labels} />
					);
				}
				return <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground">{children}</code>;
			},
			pre: ({ children }) => <>{children}</>,
			blockquote: ({ children }) => (
				<blockquote className="my-2 border-l-2 border-primary/10 pl-3 text-[13px] italic text-muted-foreground">
					{children}
				</blockquote>
			),
			table: ({ children }) => <MarkdownTable fontSizeClass="text-[12px]">{children}</MarkdownTable>,
			thead: ({ children }) => <MarkdownTableHead>{children}</MarkdownTableHead>,
			tbody: ({ children }) => <MarkdownTableBody>{children}</MarkdownTableBody>,
			tr: ({ children }) => <MarkdownTableRow>{children}</MarkdownTableRow>,
			th: ({ children, style }) => <MarkdownTableHeaderCell style={style}>{children}</MarkdownTableHeaderCell>,
			td: ({ children, style }) => <MarkdownTableCell style={style}>{children}</MarkdownTableCell>,
			hr: () => <hr className="my-3 border-border" />,
			a: ({ href, children }) => (
				<a
					href={href}
					className="text-primary underline decoration-primary/30 hover:decoration-primary"
					target={isExternalLink(href) ? "_blank" : undefined}
					rel={isExternalLink(href) ? "noopener noreferrer" : undefined}
					onClick={(event) => handleLinkClick(event, href)}
				>
					{href && /^https?:\/\//i.test(href) && (
						<>
							<WebsiteIcon href={href} />{" "}
						</>
					)}
					{children}
				</a>
			),
			strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
			em: ({ children }) => <em className="italic">{children}</em>,
			"vetta-svg": ({ node }: { node?: HastElement }) => {
				const source = node?.properties?.source;
				const rich = labels.rich ?? defaultRichContentLabels;
				return typeof source === "string" ? <SvgPreview source={source} label={rich.svg} failed={rich.failed} /> : null;
			},
			...definition.components,
			...definition.elements,
		};
	}, [theme, onOpenExternal, definition, labels]);

	return (
		<MarkdownHostProvider host={host}><div className="markdown-body break-words p-4">
			{parsed && parsed.entries.length > 0 && <Frontmatter entries={parsed.entries} />}
			<ReactMarkdown
				urlTransform={chatUrlTransform}
				remarkPlugins={[...MARKDOWN_REMARK_PLUGINS, ...(definition.remarkPlugins ?? [])]}
				rehypePlugins={definition.rehypePlugins}
				components={components}
			>
				{body}
			</ReactMarkdown>
		</div></MarkdownHostProvider>
	);
});
