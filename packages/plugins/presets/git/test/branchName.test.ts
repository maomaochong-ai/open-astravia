import { describe, expect, it } from "vitest";
import { invalidBranchName } from "../src/components/BranchBar";

const existing = ["main", "dev"];

describe("invalidBranchName", () => {
	it("accepts an ordinary name", () => {
		expect(invalidBranchName("feature/panel", existing)).toBeNull();
	});

	it("rejects an empty or whitespace-only name", () => {
		expect(invalidBranchName("", existing)).toBe("empty");
		expect(invalidBranchName("   ", existing)).toBe("empty");
	});

	it("rejects names git itself refuses", () => {
		// Every one of these would otherwise fail deep inside `git checkout -b`.
		expect(invalidBranchName("has space", existing)).toBe("chars");
		expect(invalidBranchName("bad~name", existing)).toBe("chars");
		expect(invalidBranchName("bad^name", existing)).toBe("chars");
		expect(invalidBranchName("bad:name", existing)).toBe("chars");
		expect(invalidBranchName("bad?name", existing)).toBe("chars");
		expect(invalidBranchName("bad*name", existing)).toBe("chars");
		expect(invalidBranchName("bad[name", existing)).toBe("chars");
		expect(invalidBranchName("bad\\name", existing)).toBe("chars");
		expect(invalidBranchName("-leading", existing)).toBe("chars");
		expect(invalidBranchName("trailing.", existing)).toBe("chars");
		expect(invalidBranchName("double..dot", existing)).toBe("chars");
	});

	it("rejects an existing branch name, ignoring surrounding whitespace", () => {
		expect(invalidBranchName("main", existing)).toBe("taken");
		expect(invalidBranchName("  dev  ", existing)).toBe("taken");
	});
});
