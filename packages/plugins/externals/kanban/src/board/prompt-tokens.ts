/**
 * 与宿主输入栏一致的行内 skill token（`@skill:名字` / `@skill:"名 字"`）。
 *
 * 规则对齐宿主 `input-tokens/serialize.ts` 与 `parse.ts`：token 必须落在词首
 * （行首或空白后）才会被宿主还原成胶囊；名字含空白或引号时加引号。看板把需求
 * 正文原样发进会话首轮 prompt，所以这里写出的 token 在会话页会被渲染成与宿主
 * 一致的 skill 胶囊，模型按软引用自行 invoke。
 */

/** 不含空白与引号的名字可以裸写，其余一律加引号（与宿主同一条规则）。 */
const BARE_SAFE = /^[^\s"]+$/;

export function skillTokenText(name: string): string {
	return `@skill:${BARE_SAFE.test(name) ? name : `"${name.replace(/"/g, "")}"`}`;
}

export interface PromptSegment {
	kind: "text" | "skill";
	/** 原文片段（token 段含 `@skill:` 前缀与引号）。 */
	text: string;
	/** 仅 `kind === "skill"`：还原出的 skill 名。 */
	name?: string;
}

/** 词首起匹配的 skill token；与宿主 TOKEN_RE 的 skill 分支同构。 */
const SKILL_TOKEN_RE = /(?<=^|\s)@skill:(?:"([^"]*)"|([^\s"。，、；：！？（）【】「」『』]+))/g;

/** 把正文切成「文本 + skill token」段，供高亮层渲染。 */
export function splitPromptSegments(text: string): PromptSegment[] {
	const segments: PromptSegment[] = [];
	let cursor = 0;
	SKILL_TOKEN_RE.lastIndex = 0;
	for (let match = SKILL_TOKEN_RE.exec(text); match !== null; match = SKILL_TOKEN_RE.exec(text)) {
		const name = match[1] ?? match[2] ?? "";
		if (name === "") continue;
		if (match.index > cursor) segments.push({ kind: "text", text: text.slice(cursor, match.index) });
		segments.push({ kind: "skill", text: match[0], name });
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length || segments.length === 0) segments.push({ kind: "text", text: text.slice(cursor) });
	return segments;
}

export interface MentionContext {
	/** `@` 在文本中的下标。 */
	start: number;
	/** `@` 之后、光标之前的检索词。 */
	query: string;
}

/**
 * 光标处是否正在敲一个 `@` 提及。条件：光标前存在一个落在词首的 `@`，且 `@` 与
 * 光标之间没有空白（一旦敲了空格就视为放弃提及，正文里的裸 `@` 不再打扰）。
 */
export function mentionAtCursor(text: string, cursor: number): MentionContext | null {
	const before = text.slice(0, cursor);
	const at = before.lastIndexOf("@");
	if (at < 0) return null;
	if (at > 0 && !/\s/.test(before[at - 1])) return null;
	const query = before.slice(at + 1);
	if (/\s/.test(query)) return null;
	return { start: at, query };
}

/**
 * 把 `[start, cursor)`（即 `@检索词`）替换成 skill token，token 后补一个空格与后文
 * 隔开（后文本来就以空白开头时不重复补）。返回新文本与新光标位置。
 */
export function insertSkillToken(
	text: string,
	start: number,
	cursor: number,
	name: string,
): { text: string; cursor: number } {
	const rest = text.slice(cursor);
	const token = skillTokenText(name) + (/^\s/.test(rest) ? "" : " ");
	return { text: text.slice(0, start) + token + rest, cursor: start + token.length };
}

/**
 * 在光标处追加一个 skill token（工具栏按钮路径，没有待替换的 `@`）。
 * 光标不在词首时先补一个空格，保证 token 落在词首、能被宿主还原。
 */
export function appendSkillToken(text: string, cursor: number, name: string): { text: string; cursor: number } {
	const needsGap = cursor > 0 && !/\s/.test(text[cursor - 1]);
	const token = `${needsGap ? " " : ""}${skillTokenText(name)} `;
	return { text: text.slice(0, cursor) + token + text.slice(cursor), cursor: cursor + token.length };
}
