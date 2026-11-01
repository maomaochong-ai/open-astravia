/**
 * 导入自定义能力包时用的 SKILL.md frontmatter 解析。
 *
 * 这里**故意**不用严格 YAML 解析器：用户手写的 description 常含 `:`、引号等字符，
 * 严格解析会直接报错而拒绝导入。导入端因此按行宽松取值，落盘时再由
 * `rewriteFrontmatterDescription` 把 description 规范成 double-quoted，
 * 使 agent 侧的严格 YAML 解析器能读到同一份内容。
 */

export interface SkillFrontmatter {
	name?: string;
	alias?: string;
	description?: string;
	version?: string;
}

export function extractFrontmatter(content: string): string | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return match ? match[1] : null;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' || first === "'") && first === last) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function indentWidth(line: string): number {
	const match = line.match(/^[ \t]*/);
	return match ? match[0].length : 0;
}

/** YAML 块标量指示符（`>`、`|`，可带 `-` / `+` / 缩进数字）。 */
function isBlockScalarIndicator(value: string): boolean {
	return /^[>|][-+0-9]*$/.test(value.trim());
}

/**
 * 读取块标量的续行：紧随其后、缩进更深的行按 folded 语义拼成单行。
 * 返回拼好的文本与最后一行的下标。
 */
function readBlockScalar(lines: string[], startIndex: number, baseIndent: number): { text: string; endIndex: number } {
	const parts: string[] = [];
	let index = startIndex + 1;
	for (; index < lines.length; index++) {
		const line = lines[index];
		if (line.trim().length === 0) continue;
		if (indentWidth(line) <= baseIndent) break;
		parts.push(line.trim());
	}
	return { text: parts.join(" "), endIndex: index - 1 };
}

export function parseFrontmatter(content: string): SkillFrontmatter {
	const fm = extractFrontmatter(content);
	if (!fm) return {};
	const result: SkillFrontmatter = {};
	const lines = fm.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const topMatch = lines[i].match(/^(name|alias|description):\s*(.*)$/);
		if (!topMatch) continue;
		const key = topMatch[1] as "name" | "alias" | "description";
		// `description: >` 这类块标量的正文在后续缩进行里，取首行只会得到一个 `>`。
		if (isBlockScalarIndicator(topMatch[2])) {
			const block = readBlockScalar(lines, i, indentWidth(lines[i]));
			i = block.endIndex;
			if (block.text.length > 0) result[key] = block.text;
			continue;
		}
		const value = unquote(topMatch[2]);
		if (value.length > 0) result[key] = value;
	}
	const versionMatch = fm.match(/version:\s*["']?([^\s"']+)["']?/i);
	if (versionMatch) result.version = versionMatch[1];
	return result;
}

function yamlDoubleQuote(value: string): string {
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\r/g, "\\r")
		.replace(/\n/g, "\\n")
		.replace(/\t/g, "\\t");
	return `"${escaped}"`;
}

/**
 * 把 frontmatter 中 description 字段重写为 double-quoted YAML 字符串，
 * 防止 description 包含 `:` 等字符时 YAML 解析失败（agent 用的是严格 YAML 解析器）。
 * 仅替换单行 description；其他字段原样保留。块标量（`description: >` / `|`）本身
 * 对 `:` 就是安全的，且正文在后续缩进行里——改写首行会把那些行变成孤儿，反而让
 * 严格 YAML 解析失败，因此原样保留。
 */
export function rewriteFrontmatterDescription(content: string, description: string): string {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return content;
	const original = match[0];
	const body = match[1];
	const descriptionLine = body.match(/^description:[ \t]*(.*)$/m);
	if (descriptionLine && isBlockScalarIndicator(descriptionLine[1])) return content;
	const replaced = body.replace(/^description:[ \t]*.*$/m, `description: ${yamlDoubleQuote(description)}`);
	if (replaced === body) return content;
	const eolMatch = original.match(/\r?\n/);
	const eol = eolMatch ? eolMatch[0] : "\n";
	return content.replace(original, `---${eol}${replaced}${eol}---`);
}
