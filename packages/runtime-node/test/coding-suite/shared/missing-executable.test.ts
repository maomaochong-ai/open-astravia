import { describe, expect, it } from "vitest";
import { formatMissingCodingToolError } from "../../../src/coding/shared/missing-executable.js";

describe("formatMissingCodingToolError", () => {
	it("keeps the previous sentence and adds the failure cause for fd", () => {
		const message = formatMissingCodingToolError("fd");
		expect(message).toContain("fd is not available and could not be downloaded");
		expect(message).toContain("GitHub Releases");
		expect(message).toContain("github.com is not reachable");
	});

	it("gives manual install commands for fd across platforms", () => {
		const message = formatMissingCodingToolError("fd");
		expect(message).toContain("Install it manually");
		expect(message).toContain("brew install fd");
		expect(message).toContain("apt install fd-find");
		expect(message).toContain("winget install sharkdp.fd");
		expect(message).toContain("pkg install fd");
	});

	it("names ripgrep and gives its install commands for rg", () => {
		const message = formatMissingCodingToolError("rg");
		expect(message).toContain("ripgrep (rg) is not available and could not be downloaded");
		expect(message).toContain("brew install ripgrep");
		expect(message).toContain("apt install ripgrep");
		expect(message).toContain("winget install BurntSushi.ripgrep.MSVC");
		expect(message).toContain("pkg install ripgrep");
	});
});
