import type { InputSegment } from "./types";

/** 不含空白与引号的名字可以裸写，其余一律加引号（中文名同样安全）。 */
const BARE_SAFE = /^[^\s"]+$/;

function quoteIfNeeded(value: string): string {
	return BARE_SAFE.test(value) ? value : `"${value.replace(/"/g, "")}"`;
}

/** 单个 skill token 的文本形式；Lexical 节点的 getTextContent 直接用它。 */
export function skillTokenText(name: string): string {
	return `@skill:${quoteIfNeeded(name)}`;
}

/** 单个连接器 token 的文本形式。 */
export function connectorTokenText(name: string): string {
	return `@mcp:${quoteIfNeeded(name)}`;
}

/**
 * 路径统一成 `/` 再写入 token。
 *
 * CommonMark 会把正文里的 `\.` / `\U` 等反斜杠当转义吃掉，Windows 路径
 * （尤其含 `.vetta` 的 image-cache）经消息气泡的 markdown 渲染后会断掉，
 * 图片胶囊对不上编号表就会退化成文件名。正斜杠在 Windows 上同样可被
 * 文件系统与 vetta-file 协议识别，模型侧也更稳。
 */
export function toTokenPath(path: string): string {
	return path.replace(/\\/g, "/");
}

/** 单个文件/图片 token 的文本形式。 */
export function pathTokenText(path: string): string {
	return `@${quoteIfNeeded(toTokenPath(path))}`;
}

function segmentToText(segment: InputSegment): string {
	switch (segment.kind) {
		case "text":
			return segment.text;
		case "skill":
			return skillTokenText(segment.name);
		case "connector":
			return connectorTokenText(segment.name);
		case "file":
		case "image":
			return pathTokenText(segment.path);
	}
}

/**
 * segments → 发给模型的文本。
 * token 必须落在词首才能被 parseInputSegments 还原，因此紧邻的 token
 * 之间补一个空格（`@/a@/b` 这种粘连形式无法回读）。
 */
export function segmentsToText(segments: readonly InputSegment[]): string {
	let out = "";
	for (const segment of segments) {
		const piece = segmentToText(segment);
		if (piece === "") continue;
		if (segment.kind !== "text" && out !== "" && !/\s$/.test(out)) out += " ";
		out += piece;
	}
	return out;
}

export interface DerivedAttachment {
	kind: "file" | "directory" | "image";
	path: string;
}

/** 按出现顺序去重，供 PromptRequest.attachments 与 mentionedFiles 投影使用。 */
export function deriveAttachments(segments: readonly InputSegment[]): DerivedAttachment[] {
	const byPath = new Map<string, DerivedAttachment>();
	for (const segment of segments) {
		if (segment.kind === "image") {
			byPath.set(segment.path, { kind: "image", path: segment.path });
			continue;
		}
		if (segment.kind !== "file") continue;
		byPath.set(segment.path, {
			kind: segment.isDirectory ? "directory" : "file",
			path: segment.path,
		});
	}
	return [...byPath.values()];
}

/** 文本里引用到的 skill 名（软引用，模型自行决定是否 invoke_skill）。 */
export function deriveSkillNames(segments: readonly InputSegment[]): string[] {
	const names: string[] = [];
	for (const segment of segments) {
		if (segment.kind === "skill" && !names.includes(segment.name)) names.push(segment.name);
	}
	return names;
}
