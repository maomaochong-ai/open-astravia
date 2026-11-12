import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 官网没有任何构建期的引用检查：Vite 只把 `public/` 原样复制，写错的路径不会报错，
 * 删掉的图也不会有人发现，只会一直跟着部署包发到线上。这里把「资源与选择器是否还有人用」
 * 钉成用例——新增僵尸资源的代价是这条用例变红，而不是几个月后有人手工翻目录。
 */
const ROOT = resolve(".");
const PUBLIC = join(ROOT, "public");

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

/** 会被当成「引用」的文本来源：页面 + 全部源码（含样式表里的 url()）。 */
function readSources(): string {
	const files = [join(ROOT, "index.html"), ...walk(join(ROOT, "src"))];
	return files.map((path) => readFileSync(path, "utf8")).join("\n");
}

const sourceText = readSources();

/** 文件名与「从 public 起算的路径」都算命中：CSS 里写 url("/fonts/x.woff2")，HTML 里写 src="/app/x.webp"。 */
function isReferenced(path: string): boolean {
	const rel = `/${relative(PUBLIC, path).replace(/\\/g, "/")}`;
	return sourceText.includes(rel);
}

describe("静态资源不得有僵尸", () => {
	it("public/ 下每个文件都被页面、源码或样式表引用", () => {
		const orphans = walk(PUBLIC)
			.map((path) => ({ path, rel: `/${relative(PUBLIC, path).replace(/\\/g, "/")}` }))
			// robots.txt 由爬虫直接请求，页面不会引用它。
			.filter(({ rel }) => rel !== "/robots.txt")
			.filter(({ path }) => !isReferenced(path))
			.map(({ rel }) => rel);

		expect(orphans, `以下资源没有任何引用，应删除或接回页面：\n${orphans.join("\n")}`).toEqual([]);
	});

	it("字体声明与实际文件一一对应", () => {
		const css = readFileSync(join(ROOT, "src/style.css"), "utf8");
		const declared = [...css.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
		const onDisk = walk(join(PUBLIC, "fonts")).map((p) => `/${relative(PUBLIC, p).replace(/\\/g, "/")}`);
		expect(new Set(declared)).toEqual(new Set(onDisk));
	});

	it("样式表里的每个类选择器都有人在用", () => {
		const css = readFileSync(join(ROOT, "src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
		const classes = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
		// url("/x.woff2") 里的扩展名会被当成类名，先排除掉。
		classes.delete("woff2");

		const html = readFileSync(join(ROOT, "index.html"), "utf8");
		const htmlClasses = new Set(
			[...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)),
		);
		// 源码里以字符串形式出现的类名（classList.add / toggle / 模板拼接）。
		const tsClasses = new Set(
			[...sourceText.matchAll(/["'`]([a-zA-Z][a-zA-Z0-9_ -]*)["'`]/g)].flatMap((m) => m[1].split(/\s+/)),
		);

		const unused = [...classes].filter((name) => !htmlClasses.has(name) && !tsClasses.has(name));
		expect(unused, `以下类选择器没有任何元素使用：\n${unused.join("\n")}`).toEqual([]);
	});

	it("页面里用到的类都要有样式或脚本钩子", () => {
		const css = readFileSync(join(ROOT, "src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
		const html = readFileSync(join(ROOT, "index.html"), "utf8");
		const ts = walk(join(ROOT, "src")).map((path) => readFileSync(path, "utf8")).join("\n");

		const htmlClasses = new Set(
			[...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)),
		);
		// `x--y` 这类修饰类若父类已有规则、自身只作语义标记，也要求有规则：宁可合并也不要空壳。
		const missing = [...htmlClasses].filter(
			(name) => !css.includes(`.${name}`) && !ts.includes(`"${name}"`) && !ts.includes(` ${name}`),
		);
		expect(missing, `以下类既没有样式也不是脚本钩子，应删除：\n${missing.join("\n")}`).toEqual([]);
	});

	it("页面里的 id 要么被脚本或 aria 引用，要么是导航锚点", () => {
		const html = readFileSync(join(ROOT, "index.html"), "utf8");
		const ts = walk(join(ROOT, "src")).map((path) => readFileSync(path, "utf8")).join("\n");
		const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

		// 脚本里两种写法都算引用：getElementById("x") 的裸字符串，或选择器里的 "#x"。
		const referencedByScript = (id: string): boolean =>
			new RegExp(`(?:#|")${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(ts);
		const referencedByMarkup = new Set([
			...[...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]),
			...[...html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)),
		]);
		// SVG defs 由样式表的 url(#id) 引用。
		const referencedByCss = new Set([...sourceText.matchAll(/url\(#([a-zA-Z][\w-]*)\)/g)].map((m) => m[1]));

		const unused = ids.filter(
			(id) => !referencedByScript(id) && !referencedByMarkup.has(id) && !referencedByCss.has(id),
		);
		expect(unused, `以下 id 无人引用，应删除：\n${unused.join("\n")}`).toEqual([]);
	});
});
