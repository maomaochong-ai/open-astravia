/**
 * GitHub 更新源下 electron-updater 给出的 releaseNotes 是 GitHub 渲染后的 HTML，
 * 直接交给 Markdown 渲染会被当成一整段文字挤在一起。这里把常见标签还原成 Markdown；
 * 本来就是 Markdown 的内容（不含块级 HTML 标签）原样返回。
 */

const BLOCK_HTML = /<\/?(?:h[1-6]|p|ul|ol|li|pre|blockquote|div|br|hr|table)\b/i;

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
		if (body[0] === "#") {
			const code =
				body[1]?.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[body.toLowerCase()] ?? match;
	});
}

function convertLists(html: string): string {
	// 由内向外处理，嵌套列表按层缩进。
	let result = html;
	const listPattern = /<(ul|ol)\b[^>]*>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/i;
	for (let guard = 0; guard < 50 && listPattern.test(result); guard += 1) {
		result = result.replace(listPattern, (_m, tag: string, inner: string) => {
			let index = 0;
			const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => {
				index += 1;
				const marker = tag.toLowerCase() === "ol" ? `${index}.` : "-";
				const [first = "", ...rest] = (item[1] ?? "").trim().split("\n");
				const nested = rest.filter((line) => line.trim().length > 0).map((line) => `  ${line}`);
				return [`${marker} ${first.trim()}`, ...nested].join("\n");
			});
			return `\n\n${items.join("\n")}\n\n`;
		});
	}
	return result;
}

export function releaseNotesHtmlToMarkdown(input: string): string {
	if (!BLOCK_HTML.test(input)) return input;

	let text = input.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");

	text = text.replace(/<pre\b[^>]*>\s*(?:<code\b[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_m, code: string) => {
		return `\n\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, "")).replace(/\n+$/, "")}\n\`\`\`\n\n`;
	});

	text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, body: string) => {
		return `\n\n${"#".repeat(Number(level))} ${body.replace(/<[^>]+>/g, "").trim()}\n\n`;
	});

	text = text
		.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
		.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
		.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
		.replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

	text = text.replace(/<\/p>\s*/gi, "\n\n").replace(/<p\b[^>]*>/gi, "");
	text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
	text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, body: string) => {
		const quoted = body
			.replace(/<[^>]+>/g, "")
			.trim()
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
		return `\n\n${quoted}\n\n`;
	});

	text = convertLists(text);
	text = text.replace(/<\/?(?:div|span|ul|ol|li|table|thead|tbody|tr|td|th|img|details|summary)\b[^>]*>/gi, "");

	return decodeEntities(text)
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
