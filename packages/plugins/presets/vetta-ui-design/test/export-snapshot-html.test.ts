/**
 * 分享包的内联快照。
 *
 * 这里守的是一条曾经真的把预览打成乱码的规则：内联 JS/CSS 必须按字面量替换。
 * `String.replace(string, string)` 会解释替换串里的 `$&` 之类，而压缩后的
 * react / react-router 里就有这类字符串，展开出来的 `</script>` 会让 script 提前
 * 闭合，剩下的 bundle 全部变成页面正文。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { expect, it } from "vitest";
import { buildSnapshotHtml } from "../src/export/export-design";

const INDEX_HTML = [
	"<!doctype html>",
	"<html>",
	'<head><link rel="stylesheet" href="/assets/index-abc.css">',
	'<script type="module" crossorigin src="/assets/index-xyz.js"></script>',
	"</head>",
	"<body><div id=\"root\"></div></body>",
	"</html>",
].join("\n");

function fakeCtx(files: Record<string, string>): PluginContext {
	return {
		fs: {
			readFile: async (path: string) => {
				const content = files[path];
				if (content === undefined) throw new Error(`missing ${path}`);
				return { content };
			},
		},
	} as unknown as PluginContext;
}

it("inlines the module script and stylesheet into a single document", async () => {
	const html = await buildSnapshotHtml(
		fakeCtx({
			"out/index.html": INDEX_HTML,
			"out/assets/index-xyz.js": "console.log(1)",
			"out/assets/index-abc.css": "body{margin:0}",
		}),
		"out",
	);
	expect(html).toContain('<script type="module">console.log(1)</script>');
	expect(html).toContain("<style>body{margin:0}</style>");
	expect(html).not.toContain("src=");
});

it("keeps $-patterns in the bundle literal so the script cannot close early", async () => {
	const html = await buildSnapshotHtml(
		fakeCtx({
			"out/index.html": INDEX_HTML,
			// react 压缩产物里真实存在的形状：`$&` 曾被展开成刚匹配掉的整段 script 标签。
			"out/assets/index-xyz.js": 'x.replace(re,"$&/")+y.replace(re,"$\'")+z.replace(re,"$`")+w.replace(re,"$1")',
			"out/assets/index-abc.css": "a{content:'$&'}",
		}),
		"out",
	);
	expect(html).toContain('x.replace(re,"$&/")');
	expect(html).toContain("a{content:'$&'}");
	// 只剩内联脚本自己的那一个结束标签。
	expect(html.match(/<\/script>/g)).toHaveLength(1);
});

it("escapes a literal </script> inside the bundle", async () => {
	const html = await buildSnapshotHtml(
		fakeCtx({
			"out/index.html": INDEX_HTML,
			"out/assets/index-xyz.js": 'const s="</script>"',
			"out/assets/index-abc.css": "",
		}),
		"out",
	);
	expect(html).toContain('const s="<\\/script>"');
	expect(html.match(/<\/script>/g)).toHaveLength(1);
});
