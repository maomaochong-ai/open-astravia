import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	computeInstallFingerprint,
	isInstallFresh,
	resolveInstallManifests,
	resolveStampPath,
} from "./ensure-workspace-install.mjs";

describe("Desktop dev workspace install check", () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "vetta-install-"));
		writeFileSync(
			join(repoRoot, "package.json"),
			JSON.stringify({ workspaces: ["apps/desktop", "packages/presets/*"] }),
		);
		writeFileSync(join(repoRoot, "bun.lock"), "lock-v1");
		for (const dir of ["apps/desktop", "packages/presets/a", "packages/presets/b"]) {
			mkdirSync(join(repoRoot, dir), { recursive: true });
			writeFileSync(join(repoRoot, dir, "package.json"), JSON.stringify({ name: dir }));
		}
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("covers the lockfile and every workspace manifest, including globbed ones", async () => {
		const manifests = await resolveInstallManifests(repoRoot);

		expect(manifests).toEqual([
			join(repoRoot, "bun.lock"),
			join(repoRoot, "package.json"),
			join(repoRoot, "apps/desktop/package.json"),
			join(repoRoot, "packages/presets/a/package.json"),
			join(repoRoot, "packages/presets/b/package.json"),
		]);
	});

	it("requires an install until a matching stamp exists", async () => {
		expect(await isInstallFresh(repoRoot)).toBe(false);

		mkdirSync(join(repoRoot, "node_modules"));
		writeFileSync(resolveStampPath(repoRoot), `${await computeInstallFingerprint(repoRoot)}\n`);

		expect(await isInstallFresh(repoRoot)).toBe(true);
	});

	it("requires an install again after a pull changes the lockfile or a workspace dependency", async () => {
		mkdirSync(join(repoRoot, "node_modules"));
		writeFileSync(resolveStampPath(repoRoot), await computeInstallFingerprint(repoRoot));

		writeFileSync(join(repoRoot, "bun.lock"), "lock-v2");
		expect(await isInstallFresh(repoRoot)).toBe(false);

		writeFileSync(resolveStampPath(repoRoot), await computeInstallFingerprint(repoRoot));
		writeFileSync(
			join(repoRoot, "packages/presets/b/package.json"),
			JSON.stringify({ name: "b", dependencies: { zod: "^4" } }),
		);
		expect(await isInstallFresh(repoRoot)).toBe(false);
	});
});
