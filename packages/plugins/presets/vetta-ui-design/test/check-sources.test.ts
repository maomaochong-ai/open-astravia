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
