import { describe, expect, it } from "vitest";
import { parseResourceSource, ResourcePackageLocations } from "../src/resources/packages/source-spec.js";
import type { GitSource } from "../src/utils/git.js";

const locations = new ResourcePackageLocations(process.cwd(), process.cwd(), {
	run: async () => {},
	runSync: () => "",
});

function parseGitSource(source: string): GitSource {
	const parsed = parseResourceSource(source);
	if (parsed.type !== "git") throw new Error(`Expected git source: ${source}`);
	return parsed;
}

describe("resource package git source parsing", () => {
	describe("protocol URLs without git: prefix", () => {
		it("should parse https:// URL", () => {
			const parsed = parseGitSource("https://github.com/user/repo");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
		});

		it("should parse ssh:// URL", () => {
			const parsed = parseGitSource("ssh://git@github.com/user/repo");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("ssh://git@github.com/user/repo");
		});
	});

	describe("shorthand URLs with git: prefix", () => {
		it("should parse git@host:path format", () => {
			const parsed = parseGitSource("git:git@github.com:user/repo");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
			expect(parsed.repo).toBe("git@github.com:user/repo");
			expect(parsed.pinned).toBe(false);
		});

		it("should parse host/path shorthand", () => {
			const parsed = parseGitSource("git:github.com/user/repo");
			expect(parsed.host).toBe("github.com");
			expect(parsed.path).toBe("user/repo");
		});

		it("should parse shorthand with ref", () => {
			const parsed = parseGitSource("git:git@github.com:user/repo@v1.0.0");
			expect(parsed.ref).toBe("v1.0.0");
			expect(parsed.pinned).toBe(true);
		});
	});

	describe("unsupported without git: prefix", () => {
		it("should treat git@host:path as local without git: prefix", () => {
			expect(parseResourceSource("git@github.com:user/repo").type).toBe("local");
		});

		it("should treat host/path shorthand as local without git: prefix", () => {
			expect(parseResourceSource("github.com/user/repo").type).toBe("local");
		});
	});

	it("normalizes protocol and shorthand-prefixed URLs to the same identity", () => {
		const prefixed = locations.identity("git:git@github.com:user/repo");
		const https = locations.identity("https://github.com/user/repo");
		const ssh = locations.identity("ssh://git@github.com/user/repo");

		expect(prefixed).toBe("git:github.com/user/repo");
		expect(prefixed).toBe(https);
		expect(prefixed).toBe(ssh);
	});
});
