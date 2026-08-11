/**
 * wiki 页 frontmatter 的封闭 schema 校验、解析与序列化。
 *
 * 封闭 = 只允许 WIKI_FRONTMATTER_FIELDS 这 10 个字段，出现未知字段即报错。
 * 这样缓存/检索/迁移都能依赖固定形状。
 */

import { parse, stringify } from "yaml";
import { WIKI_FRONTMATTER_FIELDS, type WikiFrontmatter } from "./types.js";

const FIELD_SET = new Set<string>(WIKI_FRONTMATTER_FIELDS);

export class WikiFrontmatterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WikiFrontmatterError";
	}
}

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((v) => typeof v === "string");

/**
 * 校验任意对象是否是合法的封闭 frontmatter，返回归一化后的 WikiFrontmatter。
 * 违反封闭性（未知字段）或类型不符均抛 WikiFrontmatterError。
 */
export function validateWikiFrontmatter(input: unknown): WikiFrontmatter {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		throw new WikiFrontmatterError("frontmatter 必须是对象");
	}
	const obj = input as Record<string, unknown>;

	const unknown = Object.keys(obj).filter((k) => !FIELD_SET.has(k));
	if (unknown.length > 0) {
		throw new WikiFrontmatterError(`封闭 schema 不允许的字段: ${unknown.join(", ")}`);
	}

	const requireString = (key: keyof WikiFrontmatter): string => {
		const v = obj[key];
		if (typeof v !== "string" || v.length === 0) {
			throw new WikiFrontmatterError(`字段 ${String(key)} 必须是非空字符串`);
		}
		return v;
	};

	if (!isStringArray(obj.tags)) {
		throw new WikiFrontmatterError("字段 tags 必须是字符串数组");
	}

	const orphanedAt = obj.orphaned_at;
	if (orphanedAt !== null && typeof orphanedAt !== "string") {
		throw new WikiFrontmatterError("字段 orphaned_at 必须是字符串或 null");
	}

	return {
		id: requireString("id"),
		source: requireString("source"),
		source_path: requireString("source_path"),
		source_hash: requireString("source_hash"),
		tags: [...obj.tags],
		title: requireString("title"),
		summary: typeof obj.summary === "string" ? obj.summary : "",
		created_at: requireString("created_at"),
		updated_at: requireString("updated_at"),
		orphaned_at: orphanedAt ?? null,
	};
}

/** 把 frontmatter 对象按固定字段顺序输出，保证序列化稳定。 */
function orderFrontmatter(fm: WikiFrontmatter): Record<string, unknown> {
	const ordered: Record<string, unknown> = {};
	for (const field of WIKI_FRONTMATTER_FIELDS) {
		ordered[field] = fm[field];
	}
	return ordered;
}

/** 序列化为带 frontmatter 的完整 markdown 文档。 */
export function serializeWikiPage(frontmatter: WikiFrontmatter, body: string): string {
	const validated = validateWikiFrontmatter(frontmatter);
	const yamlString = stringify(orderFrontmatter(validated));
	const normalizedBody = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	return `---\n${yamlString}---\n\n${normalizedBody.trim()}\n`;
}

export interface ParsedWikiPage {
	frontmatter: WikiFrontmatter;
	body: string;
}

/** 解析带 frontmatter 的 markdown，校验封闭 schema。 */
export function parseWikiPage(content: string): ParsedWikiPage {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) {
		throw new WikiFrontmatterError("wiki 页缺少 frontmatter");
	}
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		throw new WikiFrontmatterError("wiki 页 frontmatter 未闭合");
	}
	const yamlString = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();
	const raw = parse(yamlString) as unknown;
	const frontmatter = validateWikiFrontmatter(raw);
	return { frontmatter, body };
}
