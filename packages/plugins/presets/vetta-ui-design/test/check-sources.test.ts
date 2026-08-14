/**
 * 机检规则。样本取自真实翻车现场（design4/library-management）：agent 读完了
 * 完整 skill 正文，仍然伪造了 Link、自定义了 Icon、把整个组件压成一行。
 *
 * 规则宁可漏报不误报——误报会让 agent 去改本来正确的代码，比不报更糟——所以
 * 「不该命中」的用例和「该命中」的一样重要。
 */
import { expect, it } from "vitest";
import { checkSources } from "../src/vetd/check-sources";

const rulesFor = (content: string, path = "frames/demo.tsx"): string[] =>
	checkSources([{ path, content }]).map((issue) => issue.rule);

it("catches a hand-rolled router primitive", () => {
	expect(rulesFor('const Link = ({ to }: { to: string }) => <a href={to} />;')).toContain("fake-router");
	expect(rulesFor("const useLocation = () => ({ pathname: window.location.pathname });")).toContain("fake-router");
	// 真正 import 进来的不该命中
	expect(rulesFor('import { Link, useLocation } from "react-router";')).not.toContain("fake-router");
});

it("catches internal navigation written as a bare anchor", () => {
	expect(rulesFor('<a className="text-xs" href="/loans">查看全部</a>')).toContain("anchor-navigation");
	// 外链是正当的
	expect(rulesFor('<a href="https://example.com">docs</a>')).not.toContain("anchor-navigation");
	expect(rulesFor('<Link to="/loans">查看全部</Link>')).not.toContain("anchor-navigation");
});

it("catches an import of a package the engine does not have", () => {
	const issue = checkSources([
		{ path: "frames/home.tsx", content: 'import { Search } from "react-icons/fi";' },
	]).find((found) => found.rule === "uninstalled-import");
	expect(issue).toMatchObject({ rule: "uninstalled-import", line: 1 });
	expect(issue.message).toContain("react-icons");
	// 图标包要顺带被告知这里的图标是 CSS 类，否则它会换一个包再试一次
	expect(issue?.message).toContain("icon-[lucide--search]");
});

it("stays quiet on lucide-react, which the engine installs as a fallback", () => {
	// 模型对「图标」的第一反应就是 import lucide-react，纠正不掉，所以引擎装了它
	// （engine/package.json + vite.config 的 alias）。装了还报就是误报。
	expect(rulesFor('import { Search, Home } from "lucide-react";')).not.toContain("uninstalled-import");
});

it("does not flag what the engine actually ships, or local files", () => {
	const content = [
		'import React from "react";',
		'import { createRoot } from "react-dom/client";',
		'import { Link, useLocation } from "react-router";',
		'import { StatCard } from "../components/StatCard";',
		'import logo from "./assets/logo.png";',
	].join("\n");
	expect(rulesFor(content)).not.toContain("uninstalled-import");
});

it("names every missing package, not just the first", () => {
	// 一个文件里两个不同的缺失依赖是两件事：只报一个会逼 agent 修完再跑一轮。
	const content = [
		'import { Search } from "react-icons/fi";',
		'import { Chart } from "recharts";',
		'import { Home } from "react-icons/fi";',
	].join("\n");
	const issues = checkSources([{ path: "frames/home.tsx", content }]).filter(
		(issue) => issue.rule === "uninstalled-import",
	);
	expect(issues).toHaveLength(2);
	expect(issues[1].message).toContain("recharts");
	// 图表库不是图标库，不该拿到 Iconify 那套话术
	expect(issues[1].message).not.toContain("icon-[lucide--search]");
});

it("catches a re-export from a missing package too", () => {
	expect(rulesFor('export { Icon } from "@heroicons/react";')).toContain("uninstalled-import");
});

it("stays quiet on a package this design installed", () => {
	// ADR-0068：第三方库装在 x.vetd/node_modules/，判据是这份设计的 package.json。
	// 装完还报是误报里最糟的一种——agent 会回去删掉本来正确的 import。
	const content = 'import { LineChart } from "recharts";';
	const rules = checkSources([{ path: "frames/home.tsx", content }], null, ["react", "recharts"]).map(
		(issue) => issue.rule,
	);
	expect(rules).not.toContain("uninstalled-import");
	// 别的包没装，照报不误
	expect(
		checkSources([{ path: "frames/home.tsx", content: 'import Markdown from "react-markdown";' }], null, [
			"recharts",
		]).map((issue) => issue.rule),
	).toContain("uninstalled-import");
});

it("points a missing package at vetd_install", () => {
	const issue = checkSources([{ path: "frames/home.tsx", content: 'import { LineChart } from "recharts";' }]).find(
		(found) => found.rule === "uninstalled-import",
	);
	expect(issue?.message).toContain("vetd_install");
	expect(issue?.message).toContain("recharts");
});

it("never suggests installing an icon package", () => {
	// 图标是 Iconify 的 CSS 类。这里要是给出安装入口，agent 会顺着装一个图标库回来。
	const issue = checkSources([
		{ path: "frames/home.tsx", content: 'import { FiSearch } from "react-icons/fi";' },
	]).find((found) => found.rule === "uninstalled-import");
	expect(issue?.message).not.toContain("vetd_install");
	expect(issue?.message).toContain("icon-[lucide--search]");
});

it("catches an icon set the engine does not ship", () => {
	// @iconify/tailwind4 找不到集合是直接 throw，整帧构建失败。
	const issue = checkSources([
		{ path: "frames/home.tsx", content: '<span className="icon-[solar--home-linear] size-4" />' },
	]).find((found) => found.rule === "unknown-icon-set");
	expect(issue?.message).toContain('"solar"');
	expect(issue?.message).toContain("lucide, mdi, simple-icons, tabler");
	expect(rulesFor('<span className="icon-[lucide--search] size-4" />')).not.toContain("unknown-icon-set");
	expect(rulesFor('<span className="icon-[simple-icons--github] size-4" />')).not.toContain("unknown-icon-set");
});

it("catches a hand-written Icon component", () => {
	expect(rulesFor('function Icon({ name }: { name: string }) { return <svg />; }')).toContain(
		"custom-icon-component",
	);
	expect(rulesFor('<span className="icon-[lucide--search] size-4" />')).not.toContain("custom-icon-component");
});

it("catches hex colors in className but not in a stylesheet-ish string", () => {
	expect(rulesFor('<div className="bg-[#e5f4ff] text-[#545454]" />')).toContain("hardcoded-color");
	expect(rulesFor('<div className={`border ${active ? "bg-[#fff]" : ""}`} />')).toContain("hardcoded-color");
	expect(rulesFor('<div className="bg-primary text-muted" />')).not.toContain("hardcoded-color");
	// 颜色出现在别处（如 svg fill 属性）不是这条规则的事
	expect(rulesFor('<svg fill="#1e1e1e" />')).not.toContain("hardcoded-color");
});

it("catches viewport-height layouts inside a fixed-size frame", () => {
	expect(rulesFor('<div className="min-h-screen bg-white" />')).toContain("viewport-height");
	expect(rulesFor('<div className="h-full bg-white" />')).not.toContain("viewport-height");
});

it("catches minified sources that destroy element→source mapping", () => {
	expect(rulesFor(`<div>${"x".repeat(700)}</div>`)).toContain("minified-source");
	expect(rulesFor('<div className="p-4">hi</div>')).not.toContain("minified-source");
});

it("catches a frame that declares no size, and quotes the sizes already in use", () => {
	const issues = checkSources([
		{ path: "frames/home.tsx", content: 'export const frame = { width: 390, height: 844, title: "首页" };' },
		{ path: "frames/login.tsx", content: 'export const frame = { title: "登录" };' },
	]);
	expect(issues).toHaveLength(1);
	expect(issues[0]).toMatchObject({ file: "frames/login.tsx", line: null, rule: "frame-size-missing" });
	expect(issues[0].message).toContain("width and height");
	expect(issues[0].message).toContain("home 390x844");
});

it("catches a half-declared size and names only the missing side", () => {
	const [issue] = checkSources([{ path: "frames/login.tsx", content: "export const frame = { width: 390 };" }]);
	expect(issue.rule).toBe("frame-size-missing");
	expect(issue.message).toContain("missing height.");
});

it("does not ask for a size from files that are not frames", () => {
	const rules = checkSources([
		{ path: "components/AppShell.tsx", content: "export function AppShell() { return null; }" },
		{ path: "frames/_layout.tsx", content: "export default function Layout() { return null; }" },
	]).map((issue) => issue.rule);
	expect(rules).not.toContain("frame-size-missing");
});

it("reports each rule at most once per file", () => {
	const content = [
		'<a href="/a">a</a>',
		'<a href="/b">b</a>',
		'<a href="/c">c</a>',
	].join("\n");
	expect(rulesFor(content).filter((rule) => rule === "anchor-navigation")).toHaveLength(1);
});

it("reports the file and line so the agent can go straight there", () => {
	const issues = checkSources([
		{ path: "components/AppShell.tsx", content: "import React from 'react';\nconst Link = () => null;" },
	]);
	expect(issues[0]).toMatchObject({ file: "components/AppShell.tsx", line: 2, rule: "fake-router" });
});

const THEME = "@theme {\n\t--color-primary: #5e6ad2;\n\t--color-surface: #08090a;\n\t--color-muted: #8a8f98;\n}";

const tokenRules = (content: string, themeCss: string | null = THEME): string[] =>
	checkSources([{ path: "frames/demo.tsx", content }], themeCss).map((issue) => issue.rule);

it("catches a color token that theme.css never declares", () => {
	// Tailwind 对解析不出的类名不生成 CSS：元素照常占位，只是没有背景色。
	const issues = checkSources(
		[{ path: "frames/demo.tsx", content: '<div className="bg-surface-raised p-4" />' }],
		THEME,
	).filter((issue) => issue.rule === "undefined-theme-token");
	expect(issues[0]).toMatchObject({ rule: "undefined-theme-token", line: 1 });
	expect(issues[0].message).toContain("--color-surface-raised");
	// 报错里带上现有 token，省掉 agent 再去读一遍 theme.css
	expect(issues[0].message).toContain("primary");
});

it("does not invent token errors out of Tailwind's own utilities", () => {
	// 这一组全是合法的 bg-*，误报任意一条都会让 agent 去改本来正确的代码
	expect(tokenRules('<div className="bg-primary bg-surface bg-muted" />')).not.toContain("undefined-theme-token");
	expect(tokenRules('<div className="bg-white bg-black bg-transparent bg-current" />')).not.toContain(
		"undefined-theme-token",
	);
	expect(tokenRules('<div className="bg-red-500 bg-slate-50 bg-emerald-950" />')).not.toContain("undefined-theme-token");
	expect(tokenRules('<div className="bg-cover bg-center bg-no-repeat bg-fixed" />')).not.toContain(
		"undefined-theme-token",
	);
	expect(tokenRules('<div className="bg-gradient-to-r bg-clip-text bg-blend-multiply bg-linear-to-br" />')).not.toContain(
		"undefined-theme-token",
	);
});

it("says nothing when there is no theme.css to check against", () => {
	// 拿不到事实源就不做这项检查，而不是把每个 token 都当成没声明。
	expect(tokenRules('<div className="bg-surface-raised" />', null)).not.toContain("undefined-theme-token");
	expect(tokenRules('<div className="bg-surface-raised" />', "/* 没有 @theme 块 */")).not.toContain(
		"undefined-theme-token",
	);
});

it("reports each undefined token once per file", () => {
	const content = ['<div className="bg-elevated" />', '<div className="bg-elevated" />', '<div className="bg-sunken" />'].join(
		"\n",
	);
	const names = checkSources([{ path: "frames/demo.tsx", content }], THEME)
		.filter((issue) => issue.rule === "undefined-theme-token")
		.map((issue) => issue.message);
	expect(names).toHaveLength(2);
});

it("stays quiet on a correctly written frame", () => {
	const content = [
		'export const frame = { width: 1440, height: 900, title: "商品" };',
		"",
		'import { Link } from "react-router";',
		'import { StatCard } from "../components/StatCard";',
		"",
		"export default function Products() {",
		"\treturn (",
		'\t\t<div className="flex h-full flex-col gap-6 bg-surface p-8">',
		'\t\t\t<Link to="/orders" className="text-primary">',
		'\t\t\t\t<span className="icon-[lucide--package] size-4" />',
		"\t\t\t\t订单",
		"\t\t\t</Link>",
		'\t\t\t<StatCard label="在售" value="1,284" />',
		"\t\t</div>",
		"\t);",
		"}",
	].join("\n");
	expect(checkSources([{ path: "frames/products.tsx", content }])).toEqual([]);
});
