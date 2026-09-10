import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vetta Design skill presentation", () => {
	it("publishes one product-named skill while keeping other plugin skills hidden by default", () => {
		const manifest = JSON.parse(readFileSync(join(__dirname, "../plugin.json"), "utf8")) as {
			agent?: {
				skillPresentation?: {
					defaultVisibility?: string;
					skills?: Record<string, { defaultVisibility?: string; displayName?: string }>;
				};
			};
		};
		const zh = JSON.parse(readFileSync(join(__dirname, "../locales/zh.json"), "utf8")) as Record<
			string,
			string
		>;

		expect(manifest.agent?.skillPresentation).toEqual({
			defaultVisibility: "hidden",
			skills: {
				"vetta-ui-design": {
					defaultVisibility: "visible",
					displayName: "%plugin.name%",
				},
			},
		});
		expect(zh["plugin.name"]).toBe("Vetta 设计");
	});
});
