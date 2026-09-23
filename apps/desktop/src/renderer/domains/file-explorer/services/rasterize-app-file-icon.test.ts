import { describe, expect, it } from "vitest";
import { extractIconifyDataUrlFromCssValues } from "./rasterize-app-file-icon";

describe("extractIconifyDataUrlFromCssValues", () => {
	it("reads a data URL from background-image", () => {
		const url = extractIconifyDataUrlFromCssValues([
			"none",
			'url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%2F%3E")',
		]);
		expect(url?.startsWith("data:image/svg+xml")).toBe(true);
	});

	it("returns null when no icon image is present", () => {
		expect(extractIconifyDataUrlFromCssValues(["none", "", "initial"])).toBeNull();
	});

	it("preserves quotes and parentheses embedded in an Iconify SVG data URL", () => {
		const svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' style='fill:rgb(255,0,0)'/%3E";
		expect(extractIconifyDataUrlFromCssValues([`url("${svg}")`])).toBe(svg);
		expect(extractIconifyDataUrlFromCssValues(["url('data:image/png;base64,AAAA')"])).toBe(
			"data:image/png;base64,AAAA",
		);
		expect(extractIconifyDataUrlFromCssValues(["url(data:image/png;base64,AAAA)"])).toBe(
			"data:image/png;base64,AAAA",
		);
	});
});
