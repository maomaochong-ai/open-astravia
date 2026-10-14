import { describe, expect, it, vi } from "vitest";
import { batchPaths, createLintPlan, main, parseLintArgs, runLintPlan } from "./check-lint.mjs";

describe("affected lint entry point", () => {
	it("checks the Git-selected files without expanding to source roots", () => {
		const selected = ["packages/ai/src/example.ts", "deleted.ts"];
		const run = vi.fn(() => 0);
		expect(main([], { getChangedFiles: () => selected, pathExists: (file) => file !== "deleted.ts", run })).toBe(0);
		expect(run.mock.calls[0][0].slice(5)).toEqual(["packages/ai/src/example.ts"]);
		expect(run.mock.calls[0][0]).not.toContain("--write");
	});

	it("uses explicit task paths and only writes when requested", () => {
		const getChangedFiles = vi.fn(() => {
			throw new Error("Explicit paths must not query Git");
		});
		const run = vi.fn(() => 0);
		expect(
			main(["--write", "--", "packages/ai/src/example.ts"], { getChangedFiles, pathExists: () => true, run }),
		).toBe(0);
		expect(getChangedFiles).not.toHaveBeenCalled();
		expect(run.mock.calls[0][0].slice(5)).toEqual(["--write", "packages/ai/src/example.ts"]);
	});

	it("keeps full scans explicit and rejects conflicting selection", () => {
		expect(parseLintArgs(["--full", "--write"])).toMatchObject({ full: true, write: true, files: [] });
		expect(() => parseLintArgs(["--full", "packages/ai/src/example.ts"])).toThrow("cannot be combined");
		expect(() => parseLintArgs(["--full", "--base", "origin/main"])).toThrow("cannot be combined");
		expect(() => parseLintArgs(["--unknown"])).toThrow("unknown argument");
		expect(() => parseLintArgs(["../outside.ts"])).toThrow("inside the repository");
		const run = vi.fn(() => 0);
		expect(
			main(["--full"], {
				getChangedFiles: () => {
					throw new Error("No Git in full mode");
				},
				run,
			}),
		).toBe(0);
		expect(run.mock.calls[0][0]).toContain("scripts/quality");
	});

	it("preserves configuration-wide lint impact", () => {
		const run = vi.fn(() => 0);
		expect(main(["biome.json"], { pathExists: () => true, run })).toBe(0);
		expect(run.mock.calls[0][0].slice(5)).toEqual(["."]);
	});

	it("skips empty and deleted-only changes without invoking Biome", () => {
		const run = vi.fn(() => 0);
		for (const selected of [[], ["deleted.ts"]]) {
			expect(main([], { getChangedFiles: () => selected, pathExists: () => false, run })).toBe(0);
		}
		expect(run).not.toHaveBeenCalled();
	});

	it("fails invalid bases instead of silently skipping lint", () => {
		const run = vi.fn(() => 0);
		expect(
			main([], {
				getChangedFiles: () => {
					throw new Error("Missing base");
				},
				run,
			}),
		).toBe(1);
		expect(run).not.toHaveBeenCalled();
	});

	it("checks every batch and preserves a failing exit status", () => {
		const plan = createLintPlan(["packages\\ai\\src\\a.ts", "packages/ai/src/b.ts"], () => true);
		plan.biomeBatches = batchPaths(plan.existingFiles, 30);
		const run = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(0);
		expect(runLintPlan(plan, { run })).toBe(1);
		expect(run.mock.calls.flatMap(([args]) => args.slice(5))).toEqual(plan.existingFiles);
	});
});
