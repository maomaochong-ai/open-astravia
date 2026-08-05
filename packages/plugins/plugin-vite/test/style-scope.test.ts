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
});
