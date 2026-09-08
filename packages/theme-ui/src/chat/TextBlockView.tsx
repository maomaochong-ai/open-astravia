import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlockCopyButtonView } from "../shared/CodeBlockCopyButton";
import {
	MarkdownTable,
	MarkdownTableBody,
	MarkdownTableCell,
	MarkdownTableHead,
	MarkdownTableHeaderCell,
	MarkdownTableRow,
} from "../shared/MarkdownTable";
import { SyntaxHighlightedCode } from "../shared/SyntaxHighlightedCode";
import { SkillTypeIcon } from "../skills/skill-icon";
import { InlineTokenChip } from "./InlineTokenChip";
import {
	chatUrlTransform,
	classifyMarkdownLink,
	normalizeLocalFileLinksInMarkdown,
} from "./markdown-link";

/** Minimal hast-like nodes for the streaming chunk rehype plugin. */
interface HastText {
	type: "text";
	value: string;
}
interface HastElement {
	type: "element";
	tagName: string;
	properties?: Record<string, unknown>;
	children: Array<HastText | HastElement>;
}
interface HastRoot {
	type: "root";
	children: Array<HastText | HastElement>;
}

/** 文件 / 链接 badge 的公共样式：半透明主题色底 + 主题色描边与文字。 */
const LINK_BADGE_CLASS =
	"inline-flex max-w-full items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-px align-middle text-[13px] font-medium text-primary no-underline transition-colors hover:bg-primary/20";

const remarkPlugins = [remarkGfm];

/**
 * 用户消息里的行内 token（skill / scene 引用、文件、图片）。
 * 语法归宿主所有——theme-ui 只负责渲染，解析函数由 inlineTokens.parse 注入。
 */
export type InlineTokenPiece =
	| { kind: "text"; text: string }
	| { kind: "skill"; name: string }
	| { kind: "scene"; name: string }
	| { kind: "connector"; name: string }
	| { kind: "member"; participantId: string; handle: string }
	| { kind: "file"; path: string; isDirectory?: boolean }
	| { kind: "image"; path: string };

export interface InlineTokenSupport {
	parse: (text: string) => InlineTokenPiece[];
	/** Structured annotations into the original Markdown source; never inferred from display text. */
	annotations?: readonly InlineTokenAnnotation[];
	/**
	 * 图片 token 的胶囊文案（如「图 1」）。缩略图不在文本流里渲染，
	 * 它们集中在气泡上方并带同样的编号，因此这里只要一个标签。
	 */
	getImageLabel: (path: string) => string;
	/** 连接器的展示名与 logo；查不到时回退成真实名 + 通用图标。 */
	getConnector?: (name: string) => { label: string; iconUrl?: string } | undefined;
	/**
	 * skill 的展示名与图标。文本流里只有 slug，别名/图标要宿主回查，
	 * 否则气泡里的胶囊与输入框里刚插入的那枚对不上。查不到时回退成 slug + 默认图。
	 */
	getSkill?: (name: string) => { label: string; icon?: string } | undefined;
	/** scene 与 skill 共用视觉语言，但使用场景图标和独立元数据命名空间。 */
	getScene?: (name: string) => { label: string; icon?: string } | undefined;
	/** Team member metadata resolved by stable participant identity. */
	getMember?: (participantId: string) => { label: string; avatar?: string; meta?: string } | undefined;
}

export interface InlineTokenAnnotation {
	readonly kind: "member";
	readonly participantId: string;
	readonly handle: string;
	readonly start: number;
	readonly end: number;
}

const INLINE_TOKEN_TAG = "vetta-inline-token";

/** 把文本节点里的 token 换成自定义元素；代码块与链接文本内不处理。 */
function rehypeInlineTokens(parse: (text: string) => InlineTokenPiece[]) {
	return (tree: HastRoot): void => {
		function visit(node: HastRoot | HastElement, inLiteral: boolean): void {
			const newChildren: Array<(typeof node.children)[number]> = [];
			for (const child of node.children) {
				if (child.type === "text" && !inLiteral) {
					const pieces = parse((child as HastText).value);
					if (pieces.length === 1 && pieces[0].kind === "text") {
						newChildren.push(child);
						continue;
					}
					for (const piece of pieces) {
						if (piece.kind === "text") {
							newChildren.push({ type: "text", value: piece.text } as HastText);
							continue;
						}
						newChildren.push({
							type: "element",
							tagName: INLINE_TOKEN_TAG,
							properties: {
								"data-token-kind": piece.kind,
								"data-token-value":
									piece.kind === "skill" || piece.kind === "scene" || piece.kind === "connector"
										? piece.name
										: piece.kind === "member"
											? piece.participantId
											: piece.path,
								"data-token-directory": piece.kind === "file" && piece.isDirectory ? "true" : "false",
							},
							children: [],
						});
					}
					continue;
				}
				newChildren.push(child);
				if (child.type === "element") {
					const tag = child.tagName;
					visit(child, inLiteral || tag === "code" || tag === "pre" || tag === "a");
				}
			}
			node.children = newChildren as typeof node.children;
		}

		visit(tree, false);
	};
}

interface MdastNode {
	type: string;
	value?: string;
	children?: MdastNode[];
	position?: { start?: { offset?: number }; end?: { offset?: number } };
	data?: { hName?: string; hProperties?: Record<string, unknown> };
}

function remarkInlineTokenAnnotations(annotations: readonly InlineTokenAnnotation[]) {
	return (tree: MdastNode): void => {
		function visit(node: MdastNode, inLiteral: boolean): void {
			if (!node.children) return;
			const nextChildren: MdastNode[] = [];
			for (const child of node.children) {
				const literal = inLiteral || child.type === "code" || child.type === "inlineCode" || child.type === "link";
				const nodeStart = child.position?.start?.offset;
				const nodeEnd = child.position?.end?.offset;
				if (child.type !== "text" || literal || nodeStart === undefined || nodeEnd === undefined) {
					nextChildren.push(child);
					visit(child, literal);
					continue;
				}
				const value = child.value ?? "";
				const contained = annotations.filter(
					(annotation) => annotation.start >= nodeStart && annotation.end <= nodeEnd,
				);
				if (contained.length === 0) {
					nextChildren.push(child);
					continue;
				}
				let cursor = 0;
				for (const annotation of contained) {
					const start = annotation.start - nodeStart;
					const end = annotation.end - nodeStart;
					if (start < cursor || value.slice(start, end) !== `@${annotation.handle}`) continue;
					if (start > cursor) nextChildren.push({ type: "text", value: value.slice(cursor, start) });
					nextChildren.push({
						type: "inlineToken",
						data: {
							hName: INLINE_TOKEN_TAG,
							hProperties: {
								"data-token-kind": "member",
								"data-token-value": annotation.participantId,
								"data-token-handle": annotation.handle,
							},
						},
					});
					cursor = end;
				}
				if (cursor < value.length) nextChildren.push({ type: "text", value: value.slice(cursor) });
			}
			node.children = nextChildren;
		}

		visit(tree, false);
	};
}

const STREAMING_CHUNK_SIZE = 10;

function rehypeStreamingChunks() {
	return (tree: HastRoot): void => {
		function visit(node: HastRoot | HastElement, inCode: boolean): void {
			const newChildren: Array<(typeof node.children)[number]> = [];
			for (const child of node.children) {
				if (child.type === "text" && !inCode) {
					const value = (child as HastText).value;
					for (let index = 0; index < value.length; ) {
						const spaceMatch = /^\s+/.exec(value.slice(index));
						if (spaceMatch) {
							newChildren.push({ type: "text", value: spaceMatch[0] } as HastText);
							index += spaceMatch[0].length;
							continue;
						}

						const end = getSliceEnd(value, index, STREAMING_CHUNK_SIZE);
						newChildren.push({
							type: "element",
							tagName: "span",
							properties: { className: ["streaming-chunk"] },
							children: [{ type: "text", value: value.slice(index, end) } as HastText],
						});
						index = end;
					}
				} else {
					newChildren.push(child);
					if (child.type === "element") {
						const tag = child.tagName;
						// 表格也当字面量：把单元格文字拆成 inline-block 的 chunk span 会打乱
						// 列宽测量，流式期表格会逐帧抖动。
						visit(child, inCode || tag === "code" || tag === "pre" || tag === "table");
					}
				}
			}
			node.children = newChildren as typeof node.children;
		}

		visit(tree, false);
	};
}

const streamingRehypePlugins = [rehypeStreamingChunks];
const STREAM_REVEAL_INTERVAL_MS = 500;

function getSliceEnd(text: string, start: number, count: number): number {
	let end = Math.min(text.length, start + count);
	if (end < text.length) {
		const previous = text.charCodeAt(end - 1);
		const next = text.charCodeAt(end);
		if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
			end++;
		}
	}
	return end;
}

interface StreamingDisplayState {
	displayText: string;
	animateChunks: boolean;
}

function useStreamingDisplayText(text: string, active: boolean): StreamingDisplayState {
	const [displayText, setDisplayText] = useState(() => (active ? "" : text));
	const [animateChunks, setAnimateChunks] = useState(active);
	const displayRef = useRef(active ? "" : text);
	const targetRef = useRef(text);
	const rafRef = useRef<number | null>(null);
	const revealTimerRef = useRef<number | null>(null);
	const lastRevealRef = useRef<number | null>(null);
	const settleTimerRef = useRef<number | null>(null);
	const wasActiveRef = useRef(active);

	useEffect(() => {
		targetRef.current = text;

		function clearSettleTimer(): void {
			if (settleTimerRef.current !== null) {
				window.clearTimeout(settleTimerRef.current);
				settleTimerRef.current = null;
			}
		}

		function clearRevealTimer(): void {
			if (revealTimerRef.current !== null) {
				window.clearTimeout(revealTimerRef.current);
				revealTimerRef.current = null;
			}
		}

		function scheduleSettle(): void {
			clearSettleTimer();
			settleTimerRef.current = window.setTimeout(() => {
				setAnimateChunks(false);
				settleTimerRef.current = null;
			}, STREAM_REVEAL_INTERVAL_MS);
		}

		function scheduleReveal(delayMs: number): void {
			if (delayMs <= 0) {
				if (rafRef.current === null) {
					rafRef.current = requestAnimationFrame(tick);
				}
				return;
			}
			if (revealTimerRef.current !== null) return;
			revealTimerRef.current = window.setTimeout(() => {
				revealTimerRef.current = null;
				if (rafRef.current === null) {
					rafRef.current = requestAnimationFrame(tick);
				}
			}, delayMs);
		}

		/**
		 * Non-tail mode (e.g. marketing story drives its own char reveal):
		 * mirror `text` immediately. Do not 500ms-batch catch-up — that dumps
		 * the whole backlog as one flash on top of the host’s progressive text.
		 */
		if (!active) {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			clearRevealTimer();
			clearSettleTimer();
			displayRef.current = text;
			setDisplayText(text);
			setAnimateChunks(false);
			lastRevealRef.current = null;
			wasActiveRef.current = active;
			return () => {
				clearRevealTimer();
				clearSettleTimer();
			};
		}

		if (!text.startsWith(displayRef.current)) {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			clearRevealTimer();
			clearSettleTimer();
			setDisplayText(text);
			setAnimateChunks(false);
			displayRef.current = text;
			lastRevealRef.current = null;
			wasActiveRef.current = active;
			return;
		}

		function tick(timestamp: number): void {
			rafRef.current = null;
			const target = targetRef.current;
			const current = displayRef.current;
			const backlog = target.length - current.length;

			if (backlog <= 0) {
				lastRevealRef.current = timestamp;
				return;
			}

			const previousReveal = lastRevealRef.current;
			if (previousReveal !== null && timestamp - previousReveal < STREAM_REVEAL_INTERVAL_MS) {
				scheduleReveal(STREAM_REVEAL_INTERVAL_MS - (timestamp - previousReveal));
				return;
			}
			lastRevealRef.current = timestamp;

			// Catch up to the host target for this interval (chunk animation via rehype).
			const next = target;
			displayRef.current = next;
			setAnimateChunks(true);
			setDisplayText(next);
		}

		if (active && !wasActiveRef.current && displayRef.current.length >= text.length) {
			clearSettleTimer();
			displayRef.current = "";
			setDisplayText("");
			lastRevealRef.current = null;
		}
		wasActiveRef.current = active;
		clearRevealTimer();
		clearSettleTimer();
		setAnimateChunks(true);

		if (rafRef.current === null && displayRef.current.length < text.length) {
			const previousReveal = lastRevealRef.current;
			const delayMs =
				previousReveal === null
					? 0
					: Math.max(0, STREAM_REVEAL_INTERVAL_MS - (performance.now() - previousReveal));
			scheduleReveal(delayMs);
		}

		return () => {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			clearRevealTimer();
			clearSettleTimer();
		};
	}, [text, active]);

	return { displayText, animateChunks };
}

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface TextBlockViewLabels {
	copy: string;
	copied: string;
	/** 表格工具条：复制成 GFM 表格 / CSV。 */
	copyTableMarkdown: string;
	copyTableCsv: string;
}

export interface TextBlockViewProps {
	text: string;
	isStreamingTail?: boolean;
	className?: string;
	theme: "light" | "dark";
	labels: TextBlockViewLabels;
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

function CodeBlockShell({
	lang,
	code,
	theme,
	labels,
}: {
	lang: string;
	code: string;
	theme: "light" | "dark";
	labels: TextBlockViewLabels;
}): JSX.Element {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		};
	}, []);

	const onCopy = useCallback(() => {
		void navigator.clipboard.writeText(code).then(() => {
			setCopied(true);
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
			timerRef.current = window.setTimeout(() => setCopied(false), 1500);
		});
	}, [code]);

	return (
		<CodeBlockCopyButtonView copied={copied} onCopy={onCopy} labels={labels}>
			<div className="my-2 overflow-hidden rounded-lg border border-border bg-muted">
				{lang && (
					<div className="border-b border-border px-3 py-1 text-[10px] font-medium text-muted-foreground/50">
						{lang}
					</div>
				)}
				<SyntaxHighlightedCode code={code} lang={lang} theme={theme} fontSizeClass="text-[13px]" />
			</div>
		</CodeBlockCopyButtonView>
	);
}

/**
 * Memo'd markdown renderer for chat text blocks. Host injects file/url handlers and theme.
 *
 * `components` 映射的函数引用必须在 streaming 期间保持稳定：React 把 components.p 等
 * 当成元素类型；引用一变就会整树 remount，`.streaming-chunk` 的 CSS 入场动画对已有
 * 文本整段重播，表现为 text block 高频闪烁。labels / 回调通过 ref 读取，不进 deps。
 */
export const TextBlockView = memo(function TextBlockView({
	text,
	isStreamingTail = false,
	className,
	theme,
	labels,
	getFileIconClass,
	onOpenFile,
	onOpenUrl,
	inlineTokens,
}: TextBlockViewProps): JSX.Element {
	const { displayText, animateChunks } = useStreamingDisplayText(text, isStreamingTail);

	const tableLabels = useMemo(
		() => ({
			copyMarkdown: labels.copyTableMarkdown,
			copyCsv: labels.copyTableCsv,
			copied: labels.copied,
		}),
		[labels.copyTableMarkdown, labels.copyTableCsv, labels.copied],
	);

	const labelsRef = useRef(labels);
	const tableLabelsRef = useRef(tableLabels);
	const getFileIconClassRef = useRef(getFileIconClass);
	const onOpenFileRef = useRef(onOpenFile);
	const onOpenUrlRef = useRef(onOpenUrl);
	const inlineTokensRef = useRef(inlineTokens);
	labelsRef.current = labels;
	tableLabelsRef.current = tableLabels;
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
			h4: ({ children }) => (
				<h4 className="mb-1.5 mt-2.5 text-[14px] font-semibold text-foreground">{children}</h4>
			),
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
			code: ({ className: codeClassName, children }) => {
				const raw = String(children);
				const isBlock = (codeClassName?.startsWith("language-") ?? false) || raw.includes("\n");
				if (isBlock) {
					const lang = codeClassName?.replace("language-", "") ?? "";
					const code = raw.replace(/\n$/, "");
					return (
						<CodeBlockShell lang={lang} code={code} theme={theme} labels={labelsRef.current} />
					);
				}
				return <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">{children}</code>;
			},
			pre: ({ children }) => <>{children}</>,
			blockquote: ({ children }) => (
				<blockquote className="my-2 border-l-2 border-primary/10 pl-3 text-[14px] italic text-muted-foreground">
					{children}
				</blockquote>
			),
			table: ({ children }) => (
				<MarkdownTable labels={tableLabelsRef.current}>{children}</MarkdownTable>
			),
			thead: ({ children }) => <MarkdownTableHead>{children}</MarkdownTableHead>,
			tbody: ({ children }) => <MarkdownTableBody>{children}</MarkdownTableBody>,
			tr: ({ children }) => <MarkdownTableRow>{children}</MarkdownTableRow>,
			// style 透传：remark-gfm 把 GFM 的列对齐（`|---:|`）写在这里。
			th: ({ children, style }) => (
				<MarkdownTableHeaderCell style={style}>{children}</MarkdownTableHeaderCell>
			),
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
							<span
								className={cn(getFileIconClassRef.current(fileName), "h-3.5 w-3.5 shrink-0")}
							/>
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
					<span
						className="text-chart-2 underline decoration-chart-2/30"
						title={kind.href || undefined}
					>
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
						icon={
							isDirectory
								? "icon-[solar--folder-linear]"
								: getFileIconClassRef.current(fileName)
						}
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

	const rehypePlugins = useMemo(() => {
		const plugins = [];
		if (animateChunks) plugins.push(rehypeStreamingChunks);
		if (inlineTokens) plugins.push(() => rehypeInlineTokens(inlineTokens.parse));
		return plugins.length > 0 ? plugins : undefined;
	}, [animateChunks, inlineTokens]);
	const activeRemarkPlugins = useMemo(
		() =>
			inlineTokens?.annotations?.length
				? [...remarkPlugins, () => remarkInlineTokenAnnotations(inlineTokens.annotations ?? [])]
				: remarkPlugins,
		[inlineTokens],
	);

	const markdownSource = useMemo(
		() => normalizeLocalFileLinksInMarkdown(displayText),
		[displayText],
	);

	return (
		<div className={cn("markdown-body break-words", animateChunks && "markdown-streaming-tail", className)}>
			<ReactMarkdown
				remarkPlugins={activeRemarkPlugins}
				rehypePlugins={rehypePlugins}
				components={components}
				urlTransform={chatUrlTransform}
			>
				{markdownSource}
			</ReactMarkdown>
		</div>
	);
});
