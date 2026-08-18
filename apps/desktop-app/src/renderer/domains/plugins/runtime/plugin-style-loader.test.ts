// @vitest-environment jsdom

import type { InstalledPlugin } from "@preload/api";
import { describe, expect, it, vi } from "vitest";
import { loadPluginStyles } from "./plugin-style-loader";

describe("loadPluginStyles", () => {
	it("owns and removes only the current plugin activation styles", () => {
		vi.stubGlobal("CSS", { escape: (value: string) => value });
		const handle = loadPluginStyles({
			id: "demo",
			styleUrls: ["vetta-plugin://demo/one.css", "vetta-plugin://demo/two.css"],
		} as InstalledPlugin);

		expect(document.head.querySelectorAll('style[data-vetta-plugin-id="demo"]')).toHaveLength(2);
		handle.dispose();
		expect(document.head.querySelectorAll('style[data-vetta-plugin-id="demo"]')).toHaveLength(0);
	});
});
