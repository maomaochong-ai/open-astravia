/**
 * 修复存量分享包里被写坏的内联快照。
 *
 * 0.3.1 之前的导出用 `String.replace(string, string)` 内联 JS/CSS，替换串里的 `$&`
 * 被解释成「刚匹配掉的那一段」，也就是整个 `<script … src="…"></script>` 标签，被
 * 注入进 bundle 中间（压缩后的 react 里就有 `.replace(Rt,"$&/")`）。注入进去的那段
 * 自带 `</script>`，脚本因此提前闭合，剩下的 bundle 全部变成页面正文——预览里看到
 * 的就是一整屏乱码。导出侧已经修好（见 export-design.ts 的 replaceOnce），但已经
 * 落到用户磁盘上的 `.vetdz` 修不回去，只能在读取端还原。
 *
 * 还原是确定的，不是猜：注入的内容就是被匹配掉的那个标签，把它换回 `$&` 即得原始
 * 源码。只处理 `$&`——`$'` / `` $` `` / `$1` 理论上也会展开，但它们注入的是 HTML 的
 * 其余部分而非完整标签，不构成同一种「提前闭合」的破坏；真遇到时下面的校验会发现
 * 还有多余的结束标签，那就放弃修复、按原样交出去。
 */

/** 内联成功的脚本没有 src；带 src 的完整 script 标签只可能是 `$&` 展开的产物。 */
const INJECTED_SCRIPT = /<script[^>]*\ssrc="[^"]*"[^>]*><\/script>/g;
/** 同理，样式内联之后不该再有 stylesheet link。 */
const INJECTED_LINK = /<link[^>]*rel="stylesheet"[^>]*href="[^"]*"[^>]*>/g;

/** 文档是否已经把脚本内联了（内联标签没有 src）。 */
function hasInlineScript(html: string): boolean {
	return /<script[^>]*type="module"[^>]*>[^<]/.test(html.replace(INJECTED_SCRIPT, ""));
}

/**
 * 还原被 `$&` 展开污染的快照。文档没被内联过、或本来就是好的，一律原样返回。
 */
export function repairPackagedSnapshot(html: string): string {
	if (!hasInlineScript(html)) return html;
	const injectedScripts = html.match(INJECTED_SCRIPT);
	const injectedLinks = html.includes("<style>") ? html.match(INJECTED_LINK) : null;
	if (!injectedScripts && !injectedLinks) return html;
	let repaired = html.replace(INJECTED_SCRIPT, "$$&");
	if (injectedLinks) repaired = repaired.replace(INJECTED_LINK, "$$&");
	// 还原之后应当只剩内联脚本自己那一个结束标签。对不上说明破坏形式不止一种，
	// 修不干净的半成品不如原样交出去（预览至少还能显示画框结构）。
	if ((repaired.match(/<\/script>/g) ?? []).length !== 1) return html;
	return repaired;
}
