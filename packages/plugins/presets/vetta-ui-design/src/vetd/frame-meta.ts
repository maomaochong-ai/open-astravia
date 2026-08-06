import type { FrameMeta } from "./manifest-types";

/** 解析结果：尺寸没声明就是 null。没有默认尺寸——补声明是 agent 的事。 */
export interface ParsedFrameMeta {
	width: number | null;
	height: number | null;
	title: string;
}

/**
 * Parse `export const frame = { width: 390, height: 844, title: "登录" }` from
 * tsx source text. Regex-based on purpose: the meta object is a flat literal by
 * convention (enforced by the skill).
 *
 * 尺寸缺失不回落到任何默认值：一个静默的 800x600 会让 agent 以为自己写对了，
 * 画布上多出一块谁都没要的画板。缺就是缺，由调用方决定是报错还是参考邻帧。
 */
export function parseFrameMeta(source: string, fallbackTitle: string): ParsedFrameMeta {
	const match = source.match(/export\s+const\s+frame\s*=\s*\{([^}]*)\}/);
	const body = match?.[1] ?? "";
	const width = body.match(/width\s*:\s*(\d+)/);
	const height = body.match(/height\s*:\s*(\d+)/);
	const title = body.match(/title\s*:\s*["'`]([^"'`]*)["'`]/);
	return {
		width: width ? Number(width[1]) : null,
		height: height ? Number(height[1]) : null,
		title: title?.[1] ?? fallbackTitle,
	};
}

export function sameMeta(a: FrameMeta, b: FrameMeta): boolean {
	return a.width === b.width && a.height === b.height && a.title === b.title;
}

/** 标题在 tsx 里是一行字符串字面量：换行会截断声明，花括号会让上面的 `[^}]*` 提前收口。 */
export function sanitizeFrameTitle(raw: string): string {
	return raw
		.replace(/[\r\n{}]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 60);
}

/**
 * 把新标题写回 `export const frame = { ... }`。tsx 的 meta 才是标题的声明
 * （ADR-0053），只改 manifest 的话下一次 agent 动这行就被改回去了。
 * 找不到 meta 声明时返回 null——调用方据此报错，而不是往源码里瞎塞。
 */
export function withFrameTitle(source: string, title: string): string | null {
	const match = source.match(/export\s+const\s+frame\s*=\s*\{([^}]*)\}/);
	if (!match || match.index === undefined) return null;
	const literal = JSON.stringify(title);
	const body = match[1];
	const titleKey = /title\s*:\s*["'`][^"'`]*["'`]/;
	// replace 的第二参用函数形式：标题里的 `$&`、`$1` 不该被当成替换模式。
	const nextBody = titleKey.test(body)
		? body.replace(titleKey, () => `title: ${literal}`)
		: `${body.trimEnd().replace(/,$/, "")}, title: ${literal} `;
	return `${source.slice(0, match.index)}export const frame = {${nextBody}}${source.slice(match.index + match[0].length)}`;
}
