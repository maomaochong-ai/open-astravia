import { describe, expect, it } from "vitest";
import {
	findDesktopPackagingContractViolations,
	usesUnsupportedDesktopBundleAlias,
} from "./verify-packaging-contract.mjs";

describe("Desktop packaging contract", () => {
	it("passes the repository packaging layout", () => {
		expect(findDesktopPackagingContractViolations()).toEqual([]);
	});

	it("rejects TypeScript-only aliases from main and preload bundle sources", () => {
		expect(usesUnsupportedDesktopBundleAlias('import { value } from "@/shared/example.js";')).toBe(true);
		expect(usesUnsupportedDesktopBundleAlias('const value = await import("@/shared/example.js");')).toBe(true);
		expect(usesUnsupportedDesktopBundleAlias('import { value } from "../../shared/example.js";')).toBe(false);
	});
});
