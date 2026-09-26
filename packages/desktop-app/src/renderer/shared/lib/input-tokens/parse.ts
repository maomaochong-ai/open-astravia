import { parseDbTableMentions } from "@shared/lib/db-mentions";
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
// 命名空间分组扩展 skill/mcp/db 三类，db-table 统一走命名空间前缀避免 @xxx.yyy 歧义
const TOKEN_RE = new RegExp(`(?<=^|\\s)@(?:(skill|mcp|db):(?:"([^"]*)"|(${BARE}))|(?:"([^"]*)"|(${BARE})))`, "g");

/** 裸路径末尾的半角句读；它们属于句子而不属于路径。 */
const TRAILING_PUNCTUATION = /[,;:!?)\]]+$/;

/** 旧格式：行首 `/skill:name`，其后紧跟一个换行。 */
const LEGACY_REF_RE = /^\/(skill):([^\n]+)\n?([\s\S]*)$/;

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
function scanInline(body: string, segments: InputSegment[], validConnections?: readonly string[]): void {
	let cursor = 0;
	TOKEN_RE.lastIndex = 0;
	for (let match = TOKEN_RE.exec(body); match !== null; match = TOKEN_RE.exec(body)) {
		const [raw, namespace, quotedName, bareName, quotedPath, barePath] = match;
		const start = match.index;

		if (namespace !== undefined) {
			const name = quotedName ?? bareName ?? "";
			if (name === "") continue;

			pushText(segments, body.slice(cursor, start));

			if (namespace === "db") {
				// ⚠️ TOKEN_RE 的 BARE 不包含 `.`——所以 @db:conn.table 只会匹配到 "conn"
				// 这里手动向后扩展读取 .table 甚至 .scope.table 分段
				// 同时处理 quotedName（TOKEN_RE 会剥离引号）→ 重建带引号的完整段
				const hadQuotes = quotedName !== undefined;
				let name = quotedName ?? bareName ?? "";
				if (hadQuotes) {
					// quotedName 不含引号，需要手动加回去才能 round-trip
					name = `"${name}"`;
				}

				let cursorAfterMatch = start + raw.length;
				while (cursorAfterMatch < body.length && body[cursorAfterMatch] === ".") {
					cursorAfterMatch++; // 跳过 .
					let nextSegment = "";
					if (body[cursorAfterMatch] === '"' || body[cursorAfterMatch] === "`") {
						const quote = body[cursorAfterMatch]!;
						nextSegment += quote;
						cursorAfterMatch++;
						while (cursorAfterMatch < body.length && body[cursorAfterMatch] !== quote) {
							nextSegment += body[cursorAfterMatch]!;
							cursorAfterMatch++;
						}
						if (cursorAfterMatch < body.length) {
							nextSegment += body[cursorAfterMatch]!;
							cursorAfterMatch++;
						}
					} else {
						while (
							cursorAfterMatch < body.length &&
							/[^\s。，、；：！？（）【】「」『』.]/.test(body[cursorAfterMatch]!)
						) {
							nextSegment += body[cursorAfterMatch]!;
							cursorAfterMatch++;
						}
					}
					if (!nextSegment) break;
					name += `.${nextSegment}`;
				}

				// 用 parseDbTableMentions("legacy" 模式) 从完整 name 提取 connection/scope/table
				const mentions = parseDbTableMentions(`@${name}`, validConnections, "legacy");
				if (mentions.length === 1) {
					const m = mentions[0]!;
					segments.push({
						kind: "db-table",
						connection: m.connection,
						scope: m.scope,
						table: m.table,
					});
					cursor = cursorAfterMatch;
					continue;
				}
				segments.push({ kind: "skill", name: `db:${name}` });
				cursor = start + raw.length;
				continue;
			}

			segments.push({ kind: namespace === "mcp" ? "connector" : "skill", name });
			cursor = start + raw.length;
			continue;
		}

		if (quotedPath !== undefined) {
			pushText(segments, body.slice(cursor, start));
			if (isAttachmentPath(quotedPath)) {
				pushPath(segments, quotedPath);
			} else {
				// 非 attachment path 的 @"xxx" → 不再尝试 db-table 识别！
				// db-table 现在必须走 @db: 命名空间前缀，彻底消除 @hello.world 歧义
				pushText(segments, match[0]!);
			}
			cursor = start + raw.length;
			continue;
		}

		if (barePath === undefined) continue;
		const trailing = barePath.match(TRAILING_PUNCTUATION)?.[0] ?? "";
		const path = trailing ? barePath.slice(0, barePath.length - trailing.length) : barePath;
		const consumedLen = raw.length - trailing.length;
		pushText(segments, body.slice(cursor, start));
		if (isAttachmentPath(path)) {
			pushPath(segments, path);
		} else {
			// ⚠️ 不再尝试旧格式 db-table 识别！
			// 无前缀的 @xxx.yyy（如用户手打 @hello.world）统一留作纯文本
			// 只有 @db:conn.table（命名空间前缀）才会被识别为 db-table
			pushText(segments, `@${path}`);
		}
		cursor = start + consumedLen;
	}
	pushText(segments, body.slice(cursor));
}

/**
 * 把一段消息文本切成「文本 + 行内 token」。
 * 输入框反序列化、用户气泡渲染、重编辑回填三处共用这一个实现。
 *
 * @param validConnections 可选——传入时只识别 connection 在列表里的 db-table mention
 *                         （严格模式）；不传则所有 @xxx.yyy[.zzz] 都识别（宽松模式）。
 *                         默认宽松：所有现有调用者拿到的都是我们自己序列化的可信文本。
 */
export function parseInputSegments(text: string, validConnections?: readonly string[]): ParsedInput {
	const { legacyRef, paths, body } = takeLegacyPrefixes(text);
	const segments: InputSegment[] = [];
	for (const path of paths) pushPath(segments, path);
	scanInline(body, segments, validConnections);
	return { segments, legacyRef };
}
