import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 构建期没有任何引用检查：public/ 里的图写错路径也不会报错，
 * 删掉的图会一直跟着部署包上线。这里把「资源与选择器是否还有人用」钉成用例。
 */
// 测试可能从仓库根或 website 目录启动，统一以本文件位置推出 website 目录。
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(ROOT, "public");

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

/** 页面是组件，所以引用来源是 src 下的 tsx/ts 与样式表。 */
function readSources(): { files: string[]; text: string } {
	const files = [join(ROOT, "index.html"), ...walk(join(ROOT, "src")).filter((path) => /\.(tsx?|css)$/.test(path))];
	return { files, text: files.map((path) => readFileSync(path, "utf8")).join("\n") };
}

const { text: sourceText } = readSources();
const css = readFileSync(join(ROOT, "src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** 资源路径允许被拼出来（`/download/${file}.webp`），所以文件名出现过就算被引用。 */
function isReferenced(path: string): boolean {
	const rel = `/${relative(PUBLIC, path).replace(/\\/g, "/")}`;
	const name = rel.split("/").pop() ?? rel;
	return sourceText.includes(rel) || sourceText.includes(name);
}

describe("静态资源不得有僵尸", () => {
	it("public/ 下每个文件都被页面、源码或样式表引用", () => {
		const orphans = walk(PUBLIC)
			.map((path) => ({ path, rel: `/${relative(PUBLIC, path).replace(/\\/g, "/")}` }))
			// robots.txt 由爬虫直接请求；banner.png 只出现在 meta 的 og:image 里；_redirects 给托管方读。
			.filter(({ rel }) => rel !== "/robots.txt" && rel !== "/banner.png" && rel !== "/_redirects")
			.filter(({ path }) => !isReferenced(path))
			.map(({ rel }) => rel);

		expect(orphans, `以下资源没有任何引用：\n${orphans.join("\n")}`).toEqual([]);
	});

	it("字体声明与实际文件一一对应", () => {
		const declared = [...css.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
		const onDisk = walk(join(PUBLIC, "fonts")).map((p) => `/${relative(PUBLIC, p).replace(/\\/g, "/")}`);
		expect(new Set(declared)).toEqual(new Set(onDisk));
	});

	it("样式表里的每个类选择器都有人在用", () => {
		const classes = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
		classes.delete("woff2");

		const inSource = new Set(
			[...sourceText.matchAll(/["'`]([a-zA-Z][a-zA-Z0-9_ -]*)["'`]/g)].flatMap((m) => m[1].split(/\s+/)),
		);
		// 模板拼接的类名（`kind-row${...}`）以片段出现，按前缀也算命中。
		const unused = [...classes].filter(
			(name) => !inSource.has(name) && !sourceText.includes(name) && !sourceText.includes(name.replace(/__.*$/, "")),
		);
		expect(unused, `以下类选择器没有任何元素使用：\n${unused.join("\n")}`).toEqual([]);
	});

	it("只用 classNames 里写死的类名，不出现无样式的拼写错误", () => {
		const inCss = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
		// 只取静态字符串写法（className="a b"），模板拼接的类名由上面的用例覆盖。
		const used = new Set(
			[...sourceText.matchAll(/className="([^"]+)"/g)].flatMap((m) =>
				m[1].split(/\s+/).filter((token) => /^[a-zA-Z][\w-]*$/.test(token)),
			),
		);
		const missing = [...used].filter((name) => !inCss.has(name));
		expect(missing, `以下类没有任何样式：\n${missing.join("\n")}`).toEqual([]);
	});
});
