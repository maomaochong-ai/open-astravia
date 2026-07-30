import { isAttachmentPath, isImagePath } from "./paths";
import type { InputSegment, LegacyPromptRef, ParsedInput } from "./types";

/**
 * 行内 token 扫描：`@skill:名字` / `@skill:"名字"` / `@/abs/path` / `@"/abs/path"`。
 * 只在词首（行首或空白后）起匹配，`a@b.com`、代码里的 `arr@idx` 不会被误认。
 *
 * 裸写形式排除全角句读——中文里 `@/a/b.ts。还有` 没有空白可依，
 * 只能靠这些字符断开路径（文件名中出现它们的情况可忽略；真有就加引号）。
 */
const BARE = String.raw`[^\s"。，、；：！？（）【】「」『』]+`;
const TOKEN_RE = new RegExp(`(?<=^|\\s)@(?:(skill|mcp):(?:"([^"]*)"|(${BARE}))|(?:"([^"]*)"|(${BARE})))`, "g");

/** 裸路径末尾的半角句读；它们属于句子而不属于路径。 */
const TRAILING_PUNCTUATION = /[,;:!?)\]]+$/;

/** 旧格式：行首 `/skill:name` 或 `/scene:name`，其后紧跟一个换行。 */
const LEGACY_REF_RE = /^\/(skill|scene):([^\n]+)\n?([\s\S]*)$/;

/** 旧格式：紧随其后的 `@<绝对路径>` 整行。 */
const LEGACY_FILE_RE = /^@([^\n]+)\n([\s\S]*)$/;

function pushText(segments: InputSegment[], text: string): void {
	if (text === "") return;
	const last = segments[segments.length - 1];
	if (last?.kind === "text") {
		last.text += text;
		return;
	}
	segments.push({ kind: "text", text });
}

function pushPath(segments: InputSegment[], path: string): void {
	if (isImagePath(path)) {
		segments.push({ kind: "image", path });
		return;
	}
	segments.push({ kind: "file", path });
}

/** 剥离旧会话的行首前缀，返回还原出的 token 与剩余正文。 */
function takeLegacyPrefixes(text: string): {
	legacyRef: LegacyPromptRef | null;
	paths: string[];
	body: string;
} {
	let remaining = text;
	let legacyRef: LegacyPromptRef | null = null;
	const paths: string[] = [];

	const refMatch = remaining.match(LEGACY_REF_RE);
	if (refMatch) {
		legacyRef = { kind: refMatch[1] as LegacyPromptRef["kind"], name: refMatch[2].trim() };
		remaining = refMatch[3];
	}

	while (true) {
		const fileMatch = remaining.match(LEGACY_FILE_RE);
		if (!fileMatch) break;
		const path = fileMatch[1].trim();
		// 手敲的多行 `@something` 不是附件行，遇到第一个就停，剩下的留在正文里。
		if (!isAttachmentPath(path)) break;
		paths.push(path);
		remaining = fileMatch[2];
	}

	return { legacyRef, paths, body: remaining };
}

/** 扫描正文中的行内 token；不认识的 `@…` 原样留作文本。 */
function scanInline(body: string, segments: InputSegment[]): void {
	let cursor = 0;
	TOKEN_RE.lastIndex = 0;
	for (let match = TOKEN_RE.exec(body); match !== null; match = TOKEN_RE.exec(body)) {
		const [raw, namespace, quotedName, bareName, quotedPath, barePath] = match;
		const start = match.index;

		if (namespace !== undefined) {
			const name = quotedName ?? bareName ?? "";
			if (name === "") continue;
			pushText(segments, body.slice(cursor, start));
			segments.push({ kind: namespace === "mcp" ? "connector" : "skill", name });
			cursor = start + raw.length;
			continue;
		}

		if (quotedPath !== undefined) {
			if (!isAttachmentPath(quotedPath)) continue;
			pushText(segments, body.slice(cursor, start));
			pushPath(segments, quotedPath);
			cursor = start + raw.length;
			continue;
		}

		if (barePath === undefined) continue;
		const trailing = barePath.match(TRAILING_PUNCTUATION)?.[0] ?? "";
		const path = trailing ? barePath.slice(0, barePath.length - trailing.length) : barePath;
		if (!isAttachmentPath(path)) continue;
		pushText(segments, body.slice(cursor, start));
		pushPath(segments, path);
		cursor = start + raw.length - trailing.length;
	}
	pushText(segments, body.slice(cursor));
}

/**
 * 把一段消息文本切成「文本 + 行内 token」。
 * 输入框反序列化、用户气泡渲染、重编辑回填三处共用这一个实现。
 */
export function parseInputSegments(text: string): ParsedInput {
	const { legacyRef, paths, body } = takeLegacyPrefixes(text);
	const segments: InputSegment[] = [];
	for (const path of paths) pushPath(segments, path);
	scanInline(body, segments);
	return { segments, legacyRef };
}
