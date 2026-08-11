/**
 * 从设计包的 theme.css 里取主色，用作「还没有封面」时卡片的占位底色。
 *
 * 只认 `--color-primary`：scaffold 写出来的模板一定有它，设计体系替换的也是它。
 * 取不到就返回 null，由卡片用中性色兜底——占位色是锦上添花，不值得为它做 CSS 解析。
 */
const PRIMARY_TOKEN = /--color-primary\s*:\s*([^;}\n]+)/;

export function parseAccentColor(themeCss: string): string | null {
	const match = PRIMARY_TOKEN.exec(themeCss);
	if (!match) return null;
	const value = match[1]?.trim();
	if (!value) return null;
	// 只放行字面颜色值。`var(--x)` 这类间接引用要真解析 CSS 才知道结果，
	// 而占位色拿错会直接画在卡面上，宁可退回中性色。
	if (value.startsWith("var(")) return null;
	return value;
}
