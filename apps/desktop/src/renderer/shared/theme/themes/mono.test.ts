import { describe, expect, it } from "vitest";
import { TOKEN_CSS_VAR } from "../tokens";
import { monoTheme } from "./mono";

describe("monoTheme", () => {
	it("配置正确的标识和默认主题配色（背景色、次级背景色与边框）", () => {
		expect(monoTheme.id).toBe("mono");
		expect(monoTheme.dark.background).toBe("#0f0f0f");
		expect(monoTheme.dark.secondary).toBe("#171717");
		expect(monoTheme.light.background).toBe("#faf9f9");
		expect(monoTheme.light.secondary).toBe("#f1f0f0");
		expect(monoTheme.light.border).toBe("rgb(228, 228, 228)");
		expect(monoTheme.light.input).toBe("rgb(228, 228, 228)");
	});

	it("深色与浅色 token 集合完整覆盖所有 CSS 变量映射", () => {
		const requiredKeys = Object.keys(TOKEN_CSS_VAR) as (keyof typeof TOKEN_CSS_VAR)[];
		for (const key of requiredKeys) {
			expect(monoTheme.dark[key]).toBeDefined();
			expect(monoTheme.light[key]).toBeDefined();
		}
	});
});
