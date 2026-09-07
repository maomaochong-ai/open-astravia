// @vitest-environment jsdom

import type { InstalledPlugin } from "@preload/api";
import { describe, expect, it, vi } from "vitest";
import { loadPluginStyles } from "./plugin-style-loader";

describe("loadPluginStyles", () => {
	it("owns and removes only the current plugin activation styles", () => {
		vi.stubGlobal("CSS", { escape: (value: string) => value });
		const federationLink = document.createElement("link");
		federationLink.rel = "stylesheet";
		federationLink.href = "vetta-plugin://demo/one.css";
		const nextVersionLink = document.createElement("link");
		nextVersionLink.rel = "stylesheet";
		nextVersionLink.href = "vetta-plugin://demo/versions/2.0.0/one.css";
		document.head.append(federationLink, nextVersionLink);
		const handle = loadPluginStyles({
			id: "demo",
			styleUrls: ["vetta-plugin://demo/one.css?v=1", "vetta-plugin://demo/two.css?v=1"],
		} as InstalledPlugin);

		expect(document.head.querySelectorAll('style[data-vetta-plugin-id="demo"]')).toHaveLength(2);
		handle.dispose();
		expect(document.head.querySelectorAll('style[data-vetta-plugin-id="demo"]')).toHaveLength(0);
		expect(federationLink.isConnected).toBe(false);
		expect(nextVersionLink.isConnected).toBe(true);
	});
});
