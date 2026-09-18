import { createContext, memo, useContext, useMemo, useRef } from "react";
import type { JSX } from "react";
import ReactMarkdown from "react-markdown";
import type { Components, Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { DefaultCodeBlock } from "./CodeBlock";
import {
	MarkdownTable,
	MarkdownTableBody,
	MarkdownTableCell,
	MarkdownTableHead,
	MarkdownTableHeaderCell,
	MarkdownTableRow,
} from "../shared/MarkdownTable";
import { SkillTypeIcon } from "../skills/skill-icon";
import { InlineTokenChip } from "./InlineTokenChip";
import { chatUrlTransform, classifyMarkdownLink, normalizeLocalFileLinksInMarkdown } from "./markdown-link";
import { useStreamingDisplayText, rehypeStreamingChunks } from "./streaming";
import {
	INLINE_TOKEN_TAG,
	rehypeInlineTokens,
	remarkInlineTokenAnnotations,
	projectAnnotationsToNormalizedMarkdown,
} from "./inline-tokens";
import type { InlineTokenSupport } from "./inline-tokens";
import type { HastElement } from "./nodes";
import { useMarkdownDefinition } from "./definition";
import type { MarkdownDefinition } from "./definition";
import { splitStableMarkdownBlocks } from "./stable-blocks";

/** 文件 / 链接 badge 的公共样式：半透明主题色底 + 主题色描边与文字。 */
const LINK_BADGE_CLASS =
	"inline-flex max-w-full items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-px align-middle text-[13px] font-medium text-primary no-underline transition-colors hover:bg-primary/20";

const remarkPlugins = [remarkGfm];

const MarkdownCodeLiveContext = createContext(false);

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface MarkdownLabels {
	copy: string;
	copied: string;
	/** 表格工具条：复制成 GFM 表格 / CSV。 */
}

export interface MarkdownContentProps {
	definition?: MarkdownDefinition;
	text: string;
	isStreamingTail?: boolean;
	className?: string;
	theme: "light" | "dark";
	labels: MarkdownLabels;
	getFileIconClass: (fileName: string) => string;
	onOpenFile: (path: string) => void;
	onOpenUrl: (url: string) => void;
	/** 传入即启用行内 token 渲染；仅用户消息需要，助手 markdown 不受影响。 */
	inlineTokens?: InlineTokenSupport;
}

function basename(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
	return idx === -1 ? normalized : normalized.slice(idx + 1);
}

interface MarkdownDocumentProps {
	animateChunks: boolean;
	components: Components;
	definition: MarkdownDefinition;
	inlineTokens?: InlineTokenSupport;
	live: boolean;
	text: string;
}

/**
 * 一块已经冻结或仍在增长的 markdown。独立 memo：流式时只有 tail 的 `text` 变，
 * 已提交块不会跟着整篇重跑 remark；流式结束后分块结构保持不变，已提交块不会重挂。
 */
const MarkdownDocument = memo(function MarkdownDocument({
	animateChunks,
	components,
	definition,
	inlineTokens,
	live,
	text,
}: MarkdownDocumentProps): JSX.Element {
	const hasStructuredAnnotations = inlineTokens?.annotations !== undefined;
	const rehypePlugins = useMemo(() => {
		const plugins: NonNullable<Options["rehypePlugins"]> = [...(definition.rehypePlugins ?? [])];
		if (animateChunks) plugins.push(rehypeStreamingChunks);
		if (inlineTokens && !hasStructuredAnnotations) plugins.push(() => rehypeInlineTokens(inlineTokens.parse));
		return plugins.length > 0 ? plugins : undefined;
	}, [animateChunks, hasStructuredAnnotations, inlineTokens, definition]);
	const markdownSource = useMemo(() => normalizeLocalFileLinksInMarkdown(text), [text]);
	const normalizedAnnotations = useMemo(
		() =>
			inlineTokens?.annotations
				? projectAnnotationsToNormalizedMarkdown(text, markdownSource, inlineTokens.annotations)
				: undefined,
		[text, inlineTokens?.annotations, markdownSource],
	);
	const activeRemarkPlugins = useMemo(
		() =>
			normalizedAnnotations?.length
				? [
						...remarkPlugins,
						...(definition.remarkPlugins ?? []),
						() => remarkInlineTokenAnnotations(normalizedAnnotations),
					]
				: [...remarkPlugins, ...(definition.remarkPlugins ?? [])],
		[normalizedAnnotations, definition],
	);
	const resolvedComponents = useMemo(
		() => ({ ...components, ...definition.components, ...definition.elements }),
		[components, definition],
	);
	return (
		<MarkdownCodeLiveContext.Provider value={live}>
			<ReactMarkdown
				remarkPlugins={activeRemarkPlugins}
				rehypePlugins={rehypePlugins}
				components={resolvedComponents}
				urlTransform={chatUrlTransform}
			>
				{markdownSource}
			</ReactMarkdown>
		</MarkdownCodeLiveContext.Provider>
	);
});

/**
 * Memo'd markdown renderer for chat text blocks. Host injects file/url handlers and theme.
 *
 * `components` 映射的函数引用必须在 streaming 期间保持稳定：React 把 components.p 等
 * 当成元素类型；引用一变就会整树 remount，`.streaming-chunk` 的 CSS 入场动画对已有
 * 文本整段重播，表现为 text block 高频闪烁。labels / 回调通过 ref 读取，不进 deps。
 */
export const MarkdownContent = memo(function MarkdownContent({
	text,
	isStreamingTail = false,
	className,
	theme,
	labels,
	getFileIconClass,
	onOpenFile,
	onOpenUrl,
	inlineTokens,
	definition: definitionOverride,
}: MarkdownContentProps): JSX.Element {
	const inheritedDefinition = useMarkdownDefinition();
	const definition = definitionOverride ?? inheritedDefinition;
	const definitionRef = useRef(definition);
	definitionRef.current = definition;
	const { displayText, animateChunks } = useStreamingDisplayText(text, isStreamingTail);

	const labelsRef = useRef(labels);
	const getFileIconClassRef = useRef(getFileIconClass);
	const onOpenFileRef = useRef(onOpenFile);
	const onOpenUrlRef = useRef(onOpenUrl);
	const inlineTokensRef = useRef(inlineTokens);
	labelsRef.current = labels;
	getFileIconClassRef.current = getFileIconClass;
	onOpenFileRef.current = onOpenFile;
	onOpenUrlRef.current = onOpenUrl;
	inlineTokensRef.current = inlineTokens;

	const components = useMemo<Components>(
		() => ({
			h1: ({ children }) => (
				<h1 className="mb-3 mt-4 text-[20px] font-bold leading-tight text-foreground">{children}</h1>
			),
			h2: ({ children }) => (
				<h2 className="mb-2 mt-3.5 text-[17px] font-bold leading-tight text-foreground">{children}</h2>
			),
			h3: ({ children }) => (
				<h3 className="mb-2 mt-3 text-[15px] font-semibold leading-tight text-foreground">{children}</h3>
			),
			h4: ({ children }) => <h4 className="mb-1.5 mt-2.5 text-[14px] font-semibold text-foreground">{children}</h4>,
			p: ({ children }) => <p className="my-1.5 text-[14px] leading-[1.6] text-foreground">{children}</p>,
			ul: ({ children }) => (
				<ul className="md-bullet-list my-1.5 text-[14px] leading-[1.6] text-foreground">{children}</ul>
			),
			ol: ({ children }) => (
				<ol className="my-1.5 ml-4 list-decimal space-y-0.5 text-[14px] leading-[1.6] text-foreground marker:text-primary">
					{children}
				</ol>
			),
			li: ({ children }) => <li>{children}</li>,
			code: function MarkdownCode({ className: codeClassName, children }) {
				const live = useContext(MarkdownCodeLiveContext);
				const raw = String(children);
				const isBlock = (codeClassName?.startsWith("language-") ?? false) || raw.includes("\n");
				if (isBlock) {
					const lang = codeClassName?.replace("language-", "") ?? "";
					const code = raw.replace(/\n$/, "");
					const CodeBlock = definitionRef.current.codeBlock ?? DefaultCodeBlock;
					return <CodeBlock lang={lang} code={code} theme={theme} labels={labelsRef.current} live={live} />;
				}
				return <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">{children}</code>;
			},
			pre: ({ children }) => <>{children}</>,
			blockquote: ({ children }) => (
				<blockquote className="my-2 border-l-2 border-primary/10 pl-3 text-[14px] italic text-muted-foreground">
					{children}
				</blockquote>
			),
			table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
			thead: ({ children }) => <MarkdownTableHead>{children}</MarkdownTableHead>,
			tbody: ({ children }) => <MarkdownTableBody>{children}</MarkdownTableBody>,
			tr: ({ children }) => <MarkdownTableRow>{children}</MarkdownTableRow>,
			// style 透传：remark-gfm 把 GFM 的列对齐（`|---:|`）写在这里。
			th: ({ children, style }) => <MarkdownTableHeaderCell style={style}>{children}</MarkdownTableHeaderCell>,
			td: ({ children, style }) => <MarkdownTableCell style={style}>{children}</MarkdownTableCell>,
			hr: () => <hr className="my-3 border-border" />,
			a: ({ href, children }) => {
				const kind = classifyMarkdownLink(href);
				if (kind.type === "file") {
					const fileName = basename(kind.path);
					return (
						<button
							type="button"
							title={kind.path}
							className={cn(LINK_BADGE_CLASS, "cursor-pointer")}
							onClick={() => onOpenFileRef.current(kind.path)}
						>
							<span className={cn(getFileIconClassRef.current(fileName), "h-3.5 w-3.5 shrink-0")} />
							<span className="truncate">{children}</span>
						</button>
					);
				}
				if (kind.type === "url") {
					return (
						<a
							href={kind.url}
							title={kind.url}
							className={LINK_BADGE_CLASS}
							onClick={(e) => {
								e.preventDefault();
								onOpenUrlRef.current(kind.url);
							}}
						>
							<span className="icon-[mdi--web] h-3.5 w-3.5 shrink-0" />
							<span className="truncate">{children}</span>
						</a>
					);
				}
				// mailto / fragment / unknown: never target=_blank — that opens the OS browser
				// for misclassified local paths. Keep visible but non-navigating.
				return (
					<span className="text-chart-2 underline decoration-chart-2/30" title={kind.href || undefined}>
						{children}
					</span>
				);
			},
			strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
			em: ({ children }) => <em className="italic">{children}</em>,
			// 行内 token：与输入框里的胶囊同款（半透明主题色底 + 描边，align-middle 对齐正文）。
			[INLINE_TOKEN_TAG]: ({ node }: { node?: HastElement }) => {
				const properties = node?.properties ?? {};
				const kind = String(properties["data-token-kind"] ?? "");
				const value = String(properties["data-token-value"] ?? "");
				if (!kind || !value) return null;
				if (kind === "image") {
					return (
						<InlineTokenChip
							icon="icon-[solar--gallery-linear]"
							label={inlineTokensRef.current?.getImageLabel(value) ?? basename(value)}
							title={basename(value)}
						/>
					);
				}
				if (kind === "skill" || kind === "scene") {
					const ability =
						kind === "scene"
							? inlineTokensRef.current?.getScene?.(value)
							: inlineTokensRef.current?.getSkill?.(value);
					return (
						<InlineTokenChip
							iconNode={<SkillTypeIcon type={kind} icon={ability?.icon} className="h-3 w-3" />}
							label={ability?.label ?? value}
							title={value}
						/>
					);
				}
				if (kind === "connector") {
					const connector = inlineTokensRef.current?.getConnector?.(value);
					return (
						<InlineTokenChip
							icon="icon-[solar--plug-circle-linear]"
							iconUrl={connector?.iconUrl}
							label={connector?.label ?? value}
							title={value}
						/>
					);
				}
				if (kind === "member") {
					const member = inlineTokensRef.current?.getMember?.(value);
					const handle = String(properties["data-token-handle"] ?? value);
					if (!member) return <>{`@${handle}`}</>;
					return (
						<InlineTokenChip
							iconNode={
								member.avatar ? (
									<img
										src={member.avatar}
										alt=""
										draggable={false}
										className="h-3 w-3 rounded-full object-cover"
									/>
								) : undefined
							}
							label={`@${member.label || handle}`}
							title={member.meta ? `${member.label || handle} · ${member.meta}` : handle}
							tone="member"
						/>
					);
				}
				const isDirectory = properties["data-token-directory"] === "true";
				const fileName = basename(value);
				return (
					<InlineTokenChip
						asButton
						icon={isDirectory ? "icon-[solar--folder-linear]" : getFileIconClassRef.current(fileName)}
						label={fileName}
						title={value}
						onClick={() => onOpenFileRef.current(value)}
					/>
				);
			},
		}),
		// theme 进 deps：代码块高亮主题变化时需要换组件树。其余 host 注入值走 ref。
		[theme],
	);

	// 切块一旦启用就保持到实例卸载：流式结束时 `animateChunks` 要等 settle 才关，若此刻把
	// 已冻结块并回单一文档，已上屏的节点会整段重挂并再包成 `.streaming-chunk` 重放淡入。
	// 稳定块只按已闭合的顶层围栏切分，分块与整篇渲染结果一致，因此结束后不需要再合并。
	const frozenBlocksRef = useRef(false);
	if (isStreamingTail && !inlineTokens) frozenBlocksRef.current = true;
	const split = frozenBlocksRef.current && !inlineTokens ? splitStableMarkdownBlocks(displayText) : null;
	const committed = split?.committed ?? [];
	const tail = split ? split.tail : displayText;
	const showTail = !split || tail.length > 0 || committed.length === 0;

	return (
		<div className={cn("markdown-body break-words", animateChunks && "markdown-streaming-tail", className)}>
			{committed.map((block, index) => (
				<MarkdownDocument
					key={`committed-${index}`}
					animateChunks={false}
					components={components}
					definition={definition}
					live={false}
					text={block}
				/>
			))}
			{showTail ? (
				<MarkdownDocument
					key="tail"
					animateChunks={animateChunks}
					components={components}
					definition={definition}
					inlineTokens={inlineTokens}
					live={isStreamingTail}
					text={tail}
				/>
			) : null}
		</div>
	);
});
