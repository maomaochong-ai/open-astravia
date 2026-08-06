export interface ThemeToken {
	name: string;
	value: string;
}

/** Extract `--color-*` tokens from a theme.css `@theme` block (read-only palette). */
export function parseThemeTokens(css: string): ThemeToken[] {
	const themeBlock = css.match(/@theme\s*\{([\s\S]*?)\}/);
	if (!themeBlock) return [];
	const tokens: ThemeToken[] = [];
	const pattern = /--color-([a-z0-9-]+)\s*:\s*([^;]+);/gi;
	let match = pattern.exec(themeBlock[1]);
	while (match) {
		tokens.push({ name: match[1], value: match[2].trim() });
		match = pattern.exec(themeBlock[1]);
	}
	return tokens;
}
