/**
 * 从一份 theme.css 里解析预览需要的 token（颜色/圆角/阴影）。
 * theme.css 是体系的单一真源：drawer 预览直接读它注入 CSS 变量，所见即所写。
 */
export interface PreviewTokens {
	colors: Record<string, string>;
	radius: Record<string, string>;
	shadow: Record<string, string>;
}

function parseNamespace(css: string, namespace: string): Record<string, string> {
	const out: Record<string, string> = {};
	const pattern = new RegExp(`--${namespace}-([a-z0-9-]+)\\s*:\\s*([^;]+);`, "gi");
	let match = pattern.exec(css);
	while (match) {
		out[match[1]] = match[2].trim();
		match = pattern.exec(css);
	}
	return out;
}

export function parsePreviewTokens(themeCss: string): PreviewTokens {
	return {
		colors: parseNamespace(themeCss, "color"),
		radius: parseNamespace(themeCss, "radius"),
		shadow: parseNamespace(themeCss, "shadow"),
	};
}

/** `color-mix` 淡化（预览里代替 Tailwind 的 `/15` 透明度修饰符）。 */
export function tint(color: string | undefined, percent: number): string {
	return color ? `color-mix(in srgb, ${color} ${percent}%, transparent)` : "transparent";
}
