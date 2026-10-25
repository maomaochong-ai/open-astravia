/**
 * GitHub 的 Atom feed（electron-updater 的 GitHub provider 从这里取正文）给的是
 * 已经渲染过的 HTML，而 GitHub Release API / 我们自己的发布说明文件给的是 Markdown。
 * 同一段文案因此有两种形态，渲染前在这里统一成 Markdown。
 *
 * 不做 HTML 透传：主题包不引入 rehype-raw，任何残留标签都只会被当作文本显示，
 * 所以这里把不认识的标签直接丢掉，也顺便让远端内容无法注入标记。
 */

const HTML_HINT = /<(?:h[1-6]|ul|ol|li|p|br|strong|b|em|i|code|pre|a)\b/i;

const ENTITIES: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
		if (entity.startsWith("#")) {
			const isHex = entity[1] === "x" || entity[1] === "X";
			const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[entity.toLowerCase()] ?? match;
	});
}

/** 只保留文本：`<script>` / `<style>` 连同内容一起丢掉，其余标签剥壳。 */
function stripTags(text: string): string {
	return text
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "");
}

/**
 * 把一段可能是 HTML 的发布说明转成 Markdown；已经是 Markdown 时原样返回。
 * 输出只包含文本、`#`/`-`/`**` 这类 Markdown 记号，交给 ReactMarkdown 渲染。
 */
export function normalizeReleaseNote(note: string): string {
	const trimmed = note.trim();
	if (!trimmed) return trimmed;
	// 有的 feed 会把整段 HTML 再转义一层（`&lt;h2&gt;`），不先解一次就会当成 Markdown 原样透出去，
	// 最后在界面上又变成一排标签。
	const source = HTML_HINT.test(trimmed) ? trimmed : decodeEntities(trimmed);
	if (!HTML_HINT.test(source)) return trimmed;

	const markdown = decodeEntities(
		source
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
				const text = stripTags(label).trim();
				return text ? `[${text}](${href})` : text;
			})
			.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, body: string) => {
				const text = stripTags(body).trim();
				return text ? `\n\n${"#".repeat(Math.min(Number(level), 3))} ${text}\n\n` : "\n\n";
			})
			.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, body: string) => `\n- ${body.trim()}`)
			.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, (_match, body: string) => `**${stripTags(body).trim()}**`)
			.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, (_match, body: string) => `**${stripTags(body).trim()}**`)
			.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, (_match, body: string) => `*${stripTags(body).trim()}*`)
			.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, body: string) => `\`${stripTags(body).trim()}\``)
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|ul|ol|div|pre|blockquote)>/gi, "\n\n")
			.replace(/<(p|ul|ol|div|pre|blockquote)\b[^>]*>/gi, "\n\n")
			// 其余标签（含远端塞进来的 <img onerror> 这类）一律丢掉，免得被当成正文或元素注入。
			.replace(/<[^>]*>/g, ""),
	);

	return (
		markdown
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			// 源 HTML 里 </li> 与 <li> 之间常有换行，直译会变成空行，列表被拆成段。
			.replace(/(\n- [^\n]*)\n{2,}(?=- )/g, "$1\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}
