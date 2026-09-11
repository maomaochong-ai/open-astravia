// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { getProviderIcon, PROVIDER_ICONS, ProviderIcon } from "@vetta/theme-ui/shared";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const PROVIDER_SYMBOLS = [
	"claude",
	"openai",
	"gemini",
	"deepseek",
	"grok",
	"qwen",
	"kimi",
	"minimax",
	"nvidia",
	"ollama",
	"xiaomi",
	"zai",
	"zhipu",
	"opencode",
] as const;

describe("ProviderIcon", () => {
	it("renders a color brand as a decorative image from the public registry", () => {
		const view = render(<ProviderIcon symbol="gemini" className="h-4 w-4" />);
		const image = view.container.querySelector("img");

		expect(image).not.toBeNull();
		expect(image?.getAttribute("src")).toBe(getProviderIcon("gemini"));
		expect(image?.getAttribute("alt")).toBe("");
		expect(image?.getAttribute("aria-hidden")).toBe("true");
		expect(image?.className).toContain("h-4");
	});

	it("renders a monochrome brand as a current-color mask", () => {
		const view = render(<ProviderIcon symbol="openai" className="h-4 w-4 text-primary" />);
		const icon = view.container.querySelector("span");

		expect(icon).not.toBeNull();
		expect(icon?.getAttribute("aria-hidden")).toBe("true");
		expect(icon?.className).toContain("bg-current");
		expect(icon?.className).toContain("text-primary");
		expect(icon?.getAttribute("style")).toContain("mask-image:");
		expect(icon?.getAttribute("style")).toContain(getProviderIcon("openai"));
	});

	it("does not render empty, unknown, or prototype-chain symbols", () => {
		expect(getProviderIcon(undefined)).toBeUndefined();
		expect(getProviderIcon("unknown")).toBeUndefined();
		expect(getProviderIcon("constructor")).toBeUndefined();

		const view = render(<ProviderIcon symbol="constructor" />);
		expect(view.container.childElementCount).toBe(0);
	});

	it("keeps every existing provider symbol backed by a downloaded SVG asset", () => {
		expect(Object.keys(PROVIDER_ICONS)).toHaveLength(PROVIDER_SYMBOLS.length);
		expect(Object.keys(PROVIDER_ICONS)).toEqual(expect.arrayContaining(PROVIDER_SYMBOLS));
		for (const symbol of PROVIDER_SYMBOLS) {
			expect(getProviderIcon(symbol)).toEqual(expect.any(String));
			expect(getProviderIcon(symbol)?.length).toBeGreaterThan(0);
		}
	});
});
