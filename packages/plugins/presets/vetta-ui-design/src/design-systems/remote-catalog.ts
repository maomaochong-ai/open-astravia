import type { DesignSystem } from "./types";

/**
 * 远端设计资源清单的解析与校验（纯函数，无 I/O）。
 *
 * 清单来自网络，属于不可信边界：这里做完整结构校验后才允许进入领域层。校验策略是
 * **逐条筛选**而不是整包否决——将来清单里会混入本插件还不认识的 kind（reference /
 * remixable），老版本插件必须能安全地只取自己认识的那部分。
 */

/** 单个字段的长度上限：清单是文本资源，越界说明源不对劲，不是正常内容。 */
const MAX_SPEC_BYTES = 64 * 1024;
const MAX_THEME_BYTES = 32 * 1024;
const MAX_SHORT_TEXT = 500;
/** 一次清单最多接受的条目数，防止畸形源撑爆选择器。 */
const MAX_ENTRIES = 200;

export interface RemoteCatalogResult {
	systems: DesignSystem[];
	/** 因为字段不合法被丢弃的条目 id（或索引），用于诊断，不影响可用条目。 */
	rejected: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shortText(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_SHORT_TEXT) return null;
	return trimmed;
}

function bodyText(value: unknown, maxBytes: number): string | null {
	if (typeof value !== "string") return null;
	if (value.trim().length === 0 || value.length > maxBytes) return null;
	return value;
}

function localizedText(value: unknown): { en: string; zh: string } | undefined {
	if (!isRecord(value)) return undefined;
	const en = shortText(value.en);
	const zh = shortText(value.zh);
	if (!en || !zh) return undefined;
	return { en, zh };
}

/**
 * 规范正文的健全性检查。frontmatter 由 applyDesignSystem 落盘时自己拼，条目自带一份
 * 会写出两段；而正文会进 Agent 上下文，所以它必须是「被参考的数据」，这里顺手挡掉最
 * 明显的越权写法。真正的把关在源仓库的评审流程里。
 */
function isPlausibleSpec(spec: string): boolean {
	if (spec.startsWith("---\n") || spec.startsWith("---\r\n")) return false;
	return true;
}

function parseEntry(raw: unknown): DesignSystem | null {
	if (!isRecord(raw)) return null;
	if (raw.kind !== "design-system") return null;

	const id = shortText(raw.slug);
	const name = shortText(raw.name);
	const category = shortText(raw.category);
	const blurb = shortText(raw.blurb);
	const vibe = raw.vibe === "light" || raw.vibe === "dark" ? raw.vibe : null;
	if (!id || !name || !category || !blurb || !vibe) return null;
	// id 会拼进文件内容（DESIGN.md frontmatter 的 `system:`）和查找键，收紧到 slug 形态。
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return null;

	const content = isRecord(raw.content) ? raw.content : null;
	if (!content) return null;
	const designMd = bodyText(content.spec, MAX_SPEC_BYTES);
	const themeCss = bodyText(content.theme, MAX_THEME_BYTES);
	if (!designMd || !themeCss || !isPlausibleSpec(designMd)) return null;
	// theme.css 是要原样写进用户项目的样式真源，至少得是个 @theme 块。
	if (!themeCss.includes("@theme")) return null;

	const origin = isRecord(raw.origin) ? raw.origin : null;
	const upstream = origin ? shortText(origin.upstream) : null;

	return {
		id,
		name,
		category,
		vibe,
		blurb,
		themeCss,
		designMd,
		tagline: localizedText(raw.tagline),
		source: upstream ?? undefined,
		license: shortText(raw.license) ?? undefined,
	};
}

/**
 * 把远端清单解析成可用的设计体系列表。返回 `null` 表示整包不可用（结构不对或一条
 * 都没解析出来），调用方应保持当前列表不变。
 */
export function parseRemoteCatalog(raw: unknown): RemoteCatalogResult | null {
	if (!isRecord(raw)) return null;
	if (raw.schemaVersion !== 1) return null;
	if (!Array.isArray(raw.templates)) return null;

	const systems: DesignSystem[] = [];
	const rejected: string[] = [];
	const seen = new Set<string>();

	for (const [index, entry] of raw.templates.slice(0, MAX_ENTRIES).entries()) {
		// 认识的 kind 才参与；未知 kind 直接跳过且不算失败，保证清单可以先于客户端演进。
		if (isRecord(entry) && entry.kind !== "design-system") continue;
		const parsed = parseEntry(entry);
		if (!parsed) {
			const label = isRecord(entry) && typeof entry.slug === "string" ? entry.slug : `#${index}`;
			rejected.push(label);
			continue;
		}
		if (seen.has(parsed.id)) {
			rejected.push(parsed.id);
			continue;
		}
		seen.add(parsed.id);
		systems.push(parsed);
	}

	if (systems.length === 0) return null;
	return { systems, rejected };
}
