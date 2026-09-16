import { normalizeLocalFileLinksInMarkdown } from "./markdown-link";
import type { HastElement, HastRoot, HastText } from "./nodes";
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

interface InlineTokenAnnotationRange {
	/** Exact serialized token text, used to reject stale or mismatched offsets. */
	readonly text: string;
	/** UTF-16 offsets into the original Markdown source. */
	readonly start: number;
	readonly end: number;
}

export type InlineTokenAnnotation =
	| ({ readonly kind: "skill" | "scene" | "connector"; readonly name: string } & InlineTokenAnnotationRange)
	| ({
			readonly kind: "file" | "image";
			readonly path: string;
			readonly isDirectory?: boolean;
	  } & InlineTokenAnnotationRange)
	| ({
			readonly kind: "member";
			readonly participantId: string;
			readonly handle: string;
	  } & InlineTokenAnnotationRange);

export const INLINE_TOKEN_TAG = "vetta-inline-token";

/** 把文本节点里的 token 换成自定义元素；代码块与链接文本内不处理。 */
export function rehypeInlineTokens(parse: (text: string) => InlineTokenPiece[]) {
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

export function remarkInlineTokenAnnotations(annotations: readonly InlineTokenAnnotation[]) {
	const ordered = [...annotations].sort((left, right) => left.start - right.start || left.end - right.end);
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
				const contained = ordered.filter(
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
					if (start < cursor || end <= start || value.slice(start, end) !== annotation.text) continue;
					if (annotation.kind === "member" && annotation.text !== `@${annotation.handle}`) continue;
					if (start > cursor) nextChildren.push({ type: "text", value: value.slice(cursor, start) });
					const tokenValue =
						"name" in annotation
							? annotation.name
							: "participantId" in annotation
								? annotation.participantId
								: annotation.path;
					nextChildren.push({
						type: "inlineToken",
						data: {
							hName: INLINE_TOKEN_TAG,
							hProperties: {
								"data-token-kind": annotation.kind,
								"data-token-value": tokenValue,
								...(annotation.kind === "member" ? { "data-token-handle": annotation.handle } : {}),
								...(annotation.kind === "file"
									? { "data-token-directory": annotation.isDirectory ? "true" : "false" }
									: {}),
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

export function projectAnnotationsToNormalizedMarkdown(
	source: string,
	normalizedSource: string,
	annotations: readonly InlineTokenAnnotation[],
): InlineTokenAnnotation[] {
	if (source === normalizedSource) return [...annotations];
	return annotations.flatMap((annotation): InlineTokenAnnotation[] => {
		if (source.slice(annotation.start, annotation.end) !== annotation.text) return [];
		const start = normalizeLocalFileLinksInMarkdown(source.slice(0, annotation.start)).length;
		const end = normalizeLocalFileLinksInMarkdown(source.slice(0, annotation.end)).length;
		return normalizedSource.slice(start, end) === annotation.text ? [{ ...annotation, start, end }] : [];
	});
}
