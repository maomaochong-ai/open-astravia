import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResourceAccessPort, ResourceFileInfo } from "../src/resources/contracts/resource-access.js";
import { computeSkillsFingerprint } from "../src/resources/runtime/skill-resource-state.js";

const OPTIONS = {
	cwd: "/workspace",
	agentDir: "/agent",
	includeDefaults: false,
	includeAgentSkills: false,
	manifestPath: "/manifest",
};

describe("Skill resource fingerprint", () => {
	it("overlaps metadata reads with a bound and preserves fingerprint identity across completion order", async () => {
		const fixture = createFixture();
		const first = await computeSkillsFingerprint(fixture.access, ["/skills", "/alias"], OPTIONS);
		expect(fixture.peak()).toBeGreaterThan(1);
		expect(fixture.peak()).toBeLessThanOrEqual(8);
		expect(fixture.active()).toBe(0);
		expect(first.split("\n")).toHaveLength(19); // directory + 16 files + missing entry + manifest
		expect(first).not.toContain("/alias");
		expect(first).not.toContain("node_modules");
		expect(first).not.toContain(".hidden");
		fixture.reverseCompletion();
		expect(await computeSkillsFingerprint(fixture.access, ["/skills", "/alias"], OPTIONS)).toBe(first);
		fixture.files.set("/skills/file-0", { kind: "file", modifiedAtMs: 2, size: 30 });
		const changed = await computeSkillsFingerprint(fixture.access, ["/skills"], OPTIONS);
		expect(changed).not.toBe(first);
		expect(changed).toContain("F:/skills/file-0:2:30");
		fixture.files.delete("/skills/file-0");
		expect(await computeSkillsFingerprint(fixture.access, ["/skills"], OPTIONS)).toContain("X:/skills/file-0");
	});

	it("drains in-flight reads on cancellation and can scan again", async () => {
		const controller = new AbortController();
		const fixture = createFixture(() => controller.abort(new Error("cancel scan")));
		await expect(
			computeSkillsFingerprint(fixture.access, ["/skills"], { ...OPTIONS, signal: controller.signal }),
		).rejects.toThrow("cancel scan");
		expect(fixture.active()).toBe(0);
		expect(await computeSkillsFingerprint(fixture.access, ["/skills"], OPTIONS)).toContain("F:/skills/file-15:1:10");
	});

	it("preserves first-path ownership for a symlink and its regular-file target", async () => {
		const fixture = createFixture();
		const base = fixture.access.files;
		const access: ResourceAccessPort = {
			...fixture.access,
			files: {
				...base,
				realPath: (target, options) =>
					base.realPath(target === "/skills/alias-file" ? "/skills/file-0" : target, options),
				stat: (target, options) => base.stat(target === "/skills/alias-file" ? "/skills/file-0" : target, options),
				readDirectory: async (target, options) => [
					{ name: "alias-file", kind: "other", symbolicLink: true },
					...(await base.readDirectory(target, options)),
				],
			},
		};
		const fingerprint = await computeSkillsFingerprint(access, ["/skills"], OPTIONS);
		expect(fingerprint).toContain("F:/skills/alias-file:1:10");
		expect(fingerprint).not.toContain("F:/skills/file-0:");
	});
});

function createFixture(onFileRead?: () => void) {
	const files = new Map<string, ResourceFileInfo>([
		["/skills", { kind: "directory", modifiedAtMs: 1, size: 0 }],
		...Array.from({ length: 16 }, (_, index): [string, ResourceFileInfo] => [
			`/skills/file-${index}`,
			{ kind: "file", modifiedAtMs: 1, size: 10 },
		]),
	]);
	let active = 0;
	let peak = 0;
	let reverse = false;
	const access: ResourceAccessPort = {
		paths: { ...path.posix, separator: "/", homeDirectory: () => "/home" },
		files: {
			realPath: async (target) => (target === "/alias" || target === "/skills/cycle" ? "/skills" : target),
			stat: async (target, options) => {
				active += 1;
				peak = Math.max(peak, active);
				try {
					await Promise.resolve();
					if (reverse && target.endsWith("0")) await Promise.resolve();
					if (target.startsWith("/skills/file-")) onFileRead?.();
					options?.signal?.throwIfAborted();
					return files.get(target === "/alias" || target === "/skills/cycle" ? "/skills" : target);
				} finally {
					active -= 1;
				}
			},
			readText: async () => {
				throw new Error("fingerprinting must not read contents");
			},
			readDirectory: async () =>
				["cycle", "missing", ".hidden", "node_modules", ...Array.from({ length: 16 }, (_, i) => `file-${i}`)].map(
					(name) => ({ name, kind: "file", symbolicLink: name === "cycle" }),
				),
		},
	};
	return {
		access,
		files,
		peak: () => peak,
		active: () => active,
		reverseCompletion: () => {
			reverse = true;
		},
	};
}
