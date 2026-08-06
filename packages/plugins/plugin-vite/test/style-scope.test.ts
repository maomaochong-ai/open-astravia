import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { scopePluginCss } from "../src/style-scope.js";

describe("scopePluginCss", () => {
	it("scopes ordinary selectors and maps root selectors to the plugin root", () => {
		const result = scopePluginCss(
			`:root, :host(.dark) { color: red; }\n.panel button { min-width: 6rem; }`,
			"demo-plugin",
		);

		expect(result).toContain("@scope ([data-vetta-plugin-root=demo-plugin])");
		expect(result).toContain(":scope,:scope.dark");
		expect(result).toContain(".panel button");
		expect(result).not.toContain(":root");
		expect(result).not.toContain(":host");
	});

	it("keeps keyframe selectors outside plugin scope rules", () => {
		const result = scopePluginCss(
			`@keyframes spin { from { opacity: 0; } to { opacity: 1; } }\n@media (width > 20rem) { .panel { display: block; } }`,
			"demo-plugin",
		);

		expect(result).toContain("@keyframes spin");
		expect(result).toContain("from { opacity: 0; }");
		expect(result).toContain("@media (width > 20rem)");
		expect(result.match(/@scope/g)).toHaveLength(1);
	});

	it("keeps generated Iconify mask rules global for portalled plugin UI", () => {
		const result = scopePluginCss(
			`.icon-\\[lucide--text-quote\\] { width: 1em; height: 1em; -webkit-mask-image: var(--svg); mask-image: var(--svg); --svg: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); background-color: currentColor; display: inline-block; -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }\n.panel { display: flex; }`,
			"demo-plugin",
		);
		const root = postcss.parse(result);
		const iconRule = root.nodes.find(
			(node): node is Rule => node.type === "rule" && node.selector.includes("lucide--text-quote"),
		);

		expect(iconRule?.parent).toBe(root);
		expect(result).toContain("@scope ([data-vetta-plugin-root=demo-plugin])");
	});

	it("still scopes icon-shaped selectors that contain non-Iconify declarations", () => {
		const result = scopePluginCss(
			`.icon-\\[lucide--text-quote\\] { --svg: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); mask-image: var(--svg); position: fixed; }`,
			"demo-plugin",
		);
		const root = postcss.parse(result);
		let iconRule: Rule | undefined;
		root.walkRules((rule) => {
			if (rule.selector.includes("lucide--text-quote")) iconRule = rule;
		});

		expect(iconRule?.parent?.type).toBe("atrule");
		expect(iconRule?.parent && "name" in iconRule.parent ? iconRule.parent.name : undefined).toBe("scope");
	});
});
