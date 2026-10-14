import type { HastElement, HastRoot, HastText } from "./nodes";

/**
 * 中文成对标点"——"（两个 U+2014）和"……"（两个 U+2026）：Chromium 按 UAX #14 把这两类
 * 字符都当「其后可断行」，会从成对标点中间断行，把"——"拆成"— / —"、"……"拆成"… / …"，
 * 看着像分层。这里在成对标点之间插入 U+2060 WORD JOINER（零宽、不可见）禁止断行：
 * 视觉不变，成对标点永不断开；代价是复制文本会带上不可见连接符，与主流中文站的做法一致。
 * code / pre / 表格 / SVG 是字面量，保持原样不插。
 */
const PAIRED_BREAKABLE = /([—…])(?=\1)/g;

/** 纯文本路径（思考块等不经 markdown 管线的直排文本）也用同一保护。 */
export function keepPairedPunctuation(value: string): string {
	return value.replace(PAIRED_BREAKABLE, "$1\u2060");
}

function joinPairedPunctuation(value: string): string {
	return keepPairedPunctuation(value);
}

export function rehypeKeepPairedPunctuation() {
	return (tree: HastRoot): void => {
		function visit(node: HastRoot | HastElement, literal: boolean): void {
			for (let index = 0; index < node.children.length; index++) {
				const child = node.children[index] as (typeof node.children)[number];
				if (child.type === "text") {
					if (literal) continue;
					const joined = joinPairedPunctuation((child as HastText).value);
					if (joined !== (child as HastText).value) {
						node.children[index] = { type: "text", value: joined } as HastText;
					}
					continue;
				}
				if (child.type === "element") {
					const tag = child.tagName;
					visit(child, literal || tag === "code" || tag === "pre" || tag === "table" || tag === "astravia-svg");
				}
			}
		}
		visit(tree, false);
	};
}
