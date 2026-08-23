/**
 * 存量分享包的快照修复（见 src/export/snapshot-repair.ts）。
 * 0.3.1 之前导出的 `.vetdz` 里，内联 bundle 被 `$&` 展开的 script 标签劈开，预览
 * 显示成一屏乱码；这些文件已经落到用户磁盘上，只能在读取端还原。
 */
import { expect, it } from "vitest";
import { repairPackagedSnapshot } from "../src/export/snapshot-repair";

const SCRIPT_TAG = '<script type="module" crossorigin src="/assets/index-abc.js"></script>';

/** 复刻当年的写坏过程：内联时用字符串替换，`$&` 被展开成刚匹配掉的整段标签。 */
function brokenSnapshot(js: string): string {
	const html = `<!doctype html><html><head>${SCRIPT_TAG}</head><body></body></html>`;
	return html.replace(SCRIPT_TAG, `<script type="module">${js}</script>`);
}

it("restores $& that was expanded into the inlined bundle", () => {
	const js = 'x.replace(re,"$&/")+y.replace(re,"\\\\$&")';
	const broken = brokenSnapshot(js);
	// 前提：这份输入确实是坏的（脚本被提前闭合）。
	expect((broken.match(/<\/script>/g) ?? []).length).toBeGreaterThan(1);
	const repaired = repairPackagedSnapshot(broken);
	expect(repaired).toContain(js);
	expect(repaired.match(/<\/script>/g)).toHaveLength(1);
});

it("leaves a healthy snapshot untouched", () => {
	const healthy = '<!doctype html><html><head><script type="module">console.log(1)</script><style>a{}</style></head></html>';
	expect(repairPackagedSnapshot(healthy)).toBe(healthy);
});

it("leaves a document that was never inlined untouched", () => {
	const notInlined = `<!doctype html><html><head>${SCRIPT_TAG}</head></html>`;
	expect(repairPackagedSnapshot(notInlined)).toBe(notInlined);
});

it("gives up rather than half-repair when another closing tag remains", () => {
	// 除了 `$&` 注入，脚本里还有一个未转义的字面 `</script>`：还原之后仍然收不干净。
	const broken = `${brokenSnapshot('a("$&")')}`.replace('a("', 'a("</script>');
	expect(repairPackagedSnapshot(broken)).toBe(broken);
});
