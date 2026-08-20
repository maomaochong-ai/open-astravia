import { describe, expect, it } from "vitest";
import { findDesktopPackagingContractViolations } from "./verify-packaging-contract.mjs";

describe("Desktop packaging contract", () => {
	it("passes the repository packaging layout", () => {
		expect(findDesktopPackagingContractViolations()).toEqual([]);
	});
});
