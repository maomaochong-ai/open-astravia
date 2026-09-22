import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(join(import.meta.dirname, "../../.github/workflows/desktop-release.yml"), "utf8");
const packagedWorkflow = readFileSync(
	join(import.meta.dirname, "../../.github/workflows/desktop-packaged.yml"),
	"utf8",
);
const upgradeWorkflow = readFileSync(
	join(import.meta.dirname, "../../.github/workflows/desktop-upgrade-e2e.yml"),
	"utf8",
);

const require = createRequire(join(import.meta.dirname, "../../apps/desktop/package.json"));
const { parse } = require("yaml");
const jobs = parse(workflow).jobs;
function actionSteps(name) {
	return parse(readFileSync(join(import.meta.dirname, `../../.github/actions/${name}/action.yml`), "utf8")).runs.steps;
}

describe("Desktop release workflow contracts", () => {
	it("saves successful dependency downloads before later build or verification failures", () => {
		const steps = actionSteps("install-bun-dependencies");
		const restore = steps.findIndex((step) => step.uses === "actions/cache/restore@v4");
		const install = steps.findIndex((step) => step.run?.includes("install-ci-dependencies.mjs"));
		const save = steps.findIndex((step) => step.uses === "actions/cache/save@v4");
		expect(restore).toBeLessThan(install);
		expect(install).toBeLessThan(save);
		expect(steps[save].if).toBe("steps.bun-cache.outputs.cache-hit != 'true'");
		expect(steps[restore].with.path).toBe("~/.bun/install/cache");
		expect(steps[restore].with.key).toContain("runner.arch");
	});

	it("isolates model inputs and saves resources before compilation without caching application outputs", () => {
		const steps = actionSteps("prepare-desktop-resources");
		const restore = steps.find((step) => step.uses === "actions/cache/restore@v4");
		expect(restore.with["restore-keys"]).toBeUndefined();
		for (const input of [
			"runtimes/manifest.json",
			"speech-input/model-manifest.json",
			"fetch-ocr-models.js",
			"runner.arch",
		]) {
			expect(restore.with.key).toContain(input);
		}
		const save = steps.findIndex((step) => step.uses === "actions/cache/save@v4");
		expect(steps.findIndex((step) => step.name === "Download release resources")).toBeLessThan(save);
		expect(steps[save].with.path).toBe(restore.with.path);
		expect(restore.with.path).not.toMatch(/node_modules|build-stage|\.turbo|release\//);
		expect(
			jobs.build.steps.findIndex((step) => step.uses === "./.github/actions/prepare-desktop-resources"),
		).toBeLessThan(jobs.build.steps.findIndex((step) => step.name === "Build updater artifacts"));
	});

	it("publishes the platform builds directly without a separate verification stage", () => {
		expect(jobs.build.strategy["fail-fast"]).toBe(false);
		expect(jobs.verify).toBeUndefined();
		expect(workflow).not.toContain("release-build-");
		expect(workflow).not.toContain("test:e2e:packaged");
		const buildSteps = jobs.build.steps;
		const build = buildSteps.findIndex((step) => step.name === "Build updater artifacts");
		const rename = buildSteps.findIndex((step) => step.name === "Name macOS update metadata per architecture");
		const upload = buildSteps.findIndex((step) => step.name === "Upload updater artifacts");
		expect(build).toBeLessThan(rename);
		expect(rename).toBeLessThan(upload);
		expect(buildSteps[upload].with.name).toBe("desktop-$" + "{{ matrix.platform }}");
		for (const target of ["publish-r2", "publish-github"]) {
			expect(jobs[target].needs).toEqual(["prepare", "quality", "build"]);
			expect(jobs[target].steps.find((step) => step.uses === "actions/download-artifact@v4").with.pattern).toBe(
				"desktop-*",
			);
		}
	});

	it("prewarms tag-readable downloads on the default branch without building or publishing", () => {
		const warm = parse(readFileSync(join(import.meta.dirname, "../../.github/workflows/desktop-cache.yml"), "utf8"));
		expect(warm.on.schedule).toHaveLength(1);
		expect(warm.jobs.warm.if).toContain("github.event.repository.default_branch");
		expect([...warm.jobs.warm.strategy.matrix.runner].sort()).toEqual(
			jobs.build.strategy.matrix.include.map((entry) => entry.runner).sort(),
		);
		expect(warm.jobs.warm.steps.some((step) => /dist:|publish:/.test(step.run ?? ""))).toBe(false);
	});

	it("runs quality and packaging tests before the platform matrix", () => {
		expect(workflow).toContain("  quality:");
		expect(workflow).toContain("run: bun run check");
		expect(workflow).toContain("run: bun run test:quality");
		expect(workflow).toContain("run: bun run verify:desktop:contracts");
		expect(workflow).toContain("run: bun run test:desktop:packaging");
		expect(workflow).toContain("needs: [prepare, quality]");
	});

	it("verifies the public update feed after either publish target", () => {
		expect(workflow.match(/node scripts\/verify-update-feed\.mjs/g)).toHaveLength(2);
		expect(workflow.match(/needs: \[prepare, quality, build\]/g)).toHaveLength(2);
		for (const target of ["r2", "github"]) {
			const feed = jobs[`verify-feed-${target}`];
			expect(feed.needs).toEqual(["prepare", `publish-${target}`]);
			expect(feed.steps.some((step) => step.run?.includes("verify-update-feed.mjs"))).toBe(true);
			expect(feed.steps.some((step) => step.uses?.includes("download-artifact"))).toBe(false);
			expect(feed.steps.some((step) => /publish:|gh release|matrix.command/.test(step.run ?? ""))).toBe(false);
			expect(JSON.stringify(feed)).not.toContain("secrets.");
		}
	});

	it("keeps the pull-request packaged E2E matrix cross-platform", () => {
		expect(packagedWorkflow).toContain("runner: windows-latest");
		expect(packagedWorkflow).toContain("runner: macos-latest");
		expect(packagedWorkflow).toContain("runner: ubuntu-latest");
		expect(packagedWorkflow).toContain("bun run test:e2e:packaged");
		expect(packagedWorkflow).toContain("xvfb-run --auto-servernum");
	});

	it("installs Linux bubblewrap build dependencies in packaged and release builds", () => {
		for (const workflowSource of [packagedWorkflow, workflow]) {
			expect(workflowSource).toContain("Install Linux packaging dependencies");
			expect(workflowSource).toContain("if: runner.os == 'Linux'");
			expect(workflowSource).toContain("build-essential libcap-dev meson ninja-build pkg-config xz-utils");
		}
	});

	it("builds and uploads all Linux release formats", () => {
		expect(workflow).toContain("command: dist:linux");
		expect(workflow).toContain("pkg-config xz-utils rpm");
		expect(workflow).toContain("apps/desktop/release/*.AppImage");
		expect(workflow).toContain("apps/desktop/release/*.deb");
		expect(workflow).toContain("apps/desktop/release/*.rpm");
	});

	it("keeps pull-request Linux packaging on the AppImage smoke target", () => {
		expect(packagedWorkflow).toContain("command: dist:linux:test");
		const desktopPackage = JSON.parse(
			readFileSync(join(import.meta.dirname, "../../apps/desktop/package.json"), "utf8"),
		);
		expect(desktopPackage.scripts["dist:linux:test"]).toContain("dist:linux:appimage");
	});

	it("builds and uploads all Windows release formats", () => {
		expect(workflow).toContain("command: dist:win");
		expect(workflow).toContain("apps/desktop/release/*.exe");
		expect(workflow).toContain("apps/desktop/release/*.msi");
		expect(workflow).toContain("apps/desktop/release/*.zip");

		const desktopPackage = JSON.parse(
			readFileSync(join(import.meta.dirname, "../../apps/desktop/package.json"), "utf8"),
		);
		expect(desktopPackage.scripts["dist:win"]).toBe("bun run package:win");
		expect(desktopPackage.scripts["package:win"]).toMatch(/--platform win$/);
	});

	it("keeps pull-request Windows packaging on the unpacked smoke target", () => {
		expect(packagedWorkflow).toContain("build-command: pack:win:test");
		const desktopPackage = JSON.parse(
			readFileSync(join(import.meta.dirname, "../../apps/desktop/package.json"), "utf8"),
		);
		expect(desktopPackage.scripts["pack:win:test"]).toContain("pack:win");
	});

	it("installs the Electron audio runtime required by Ubuntu 24.04", () => {
		const packagedSmokeJob = packagedWorkflow.split("\n  smoke:\n")[1];
		expect(packagedSmokeJob).toBeDefined();
		expect(packagedSmokeJob).toContain("Install Linux Electron runtime dependencies");
		expect(packagedSmokeJob).toContain("libasound2t64");
	});

	it("installs the IM gateway Go toolchain from its module declaration", () => {
		const packagedSmokeJob = packagedWorkflow.split("\n  smoke:\n")[1];
		const releaseBuildJob = workflow.split("\n  build:\n")[1]?.split("\n  publish-github:\n")[0];
		for (const jobSource of [packagedSmokeJob, releaseBuildJob]) {
			expect(jobSource).toBeDefined();
			expect(jobSource).toContain("Set up Go for IM gateway");
			expect(jobSource).toContain("uses: actions/setup-go@v5");
			expect(jobSource).toContain("go-version-file: apps/im-gateway/go.mod");
			expect(jobSource).toContain("cache-dependency-path: apps/im-gateway/go.sum");
		}
	});

	it("uses the same publish jobs for tagged stable and dispatched test/stable releases", () => {
		expect(workflow).toContain("build_version:");
		expect(workflow).toContain("should-publish: $" + "{{ steps.config.outputs.should_publish }}");
		expect(workflow).toContain("needs.prepare.outputs.should-publish == 'true'");
		expect(workflow).toContain("'desktop-test'");
		expect(workflow).toContain("environment: $" + "{{");
		expect(workflow).toContain("'desktop-production' }}");
		expect(workflow).toContain("OUTPUT_BUILD_VERSION");
		expect(workflow).toContain("REQUIRE_RELEASE_SIGNATURE");
		expect(workflow).toContain("needs.prepare.outputs.should-publish == 'true'");
		expect(workflow).toContain('--target "' + "$" + '{GITHUB_SHA}"');
	});

	// im-gateway 的 sidecar 由 prepare-pack.js 交叉编译进发布包，但它的 Go 测试
	// 既不在 `bun run check` 里，im-gateway.yml 也不 gate 本流水线。少了这道门禁，
	// 测试失败的 sidecar 会被静默打包发布。
	it("gates the release on the IM gateway Go tests", () => {
		const qualityJob = workflow.slice(workflow.indexOf("\n  quality:"), workflow.indexOf("\n  build:"));
		expect(qualityJob).toContain("go test ./...");
		expect(qualityJob).toContain("working-directory: apps/im-gateway");
		expect(qualityJob).toContain("go-version-file: apps/im-gateway/go.mod");
	});

	it("builds each macOS architecture on a matching hosted runner", () => {
		expect(workflow).toContain("runs-on: $" + "{{ matrix.runner }}");
		expect(workflow).toContain("runner: macos-15\n");
		expect(workflow).toContain("runner: macos-15-intel\n");
		expect(workflow).not.toContain("vetta-mac");
	});

	it("allows enough wall clock for signing and notarizing both macOS architectures", () => {
		const buildJob = workflow.slice(workflow.indexOf("\n  build:"), workflow.indexOf("\n  publish-r2:"));
		const timeout = Number(buildJob.match(/timeout-minutes: (\d+)/)?.[1]);
		expect(timeout).toBeGreaterThanOrEqual(120);
	});

	// R2 是更新源，GitHub Release 是对外的下载入口和版本说明归档。早先两个发布 job
	// 按 release_target 互斥，商业版发版在 GitHub 上什么都看不到。
	it("publishes a GitHub Release alongside R2 for every non-test channel", () => {
		expect(workflow).toContain("  publish-github:");
		expect(workflow).toContain("needs.prepare.outputs.channel != 'test'");
		expect(workflow).not.toContain("needs.prepare.outputs.release_target != 'r2'");
	});

	it("uses the versioned release note as the GitHub Release body", () => {
		expect(workflow).toContain("node scripts/release/release-notes.mjs --check");
		expect(workflow).toContain('--notes-file "' + "$" + '{NOTES_FILE}"');
		expect(workflow).not.toContain("--generate-notes");
		// 正文缺失要在质量阶段就失败，而不是等平台矩阵签名公证跑完。
		const qualityJob = workflow.slice(workflow.indexOf("\n  quality:"), workflow.indexOf("\n  build:"));
		expect(qualityJob).toContain("node scripts/release/release-notes.mjs --check");
	});

	it("provides an isolated test-channel workflow for real install and restart upgrades", () => {
		expect(upgradeWorkflow).toContain("baseline_version:");
		expect(upgradeWorkflow).toContain("candidate_version:");
		expect(upgradeWorkflow).toContain("environment: desktop-test");
		expect(upgradeWorkflow).toContain("bun run test:e2e:upgrade");
		expect(upgradeWorkflow).toContain("xvfb-run --auto-servernum");
		expect(upgradeWorkflow).toContain("upgrade-e2e-diagnostics");
	});
});
