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
const packagedJobs = parse(packagedWorkflow).jobs;
function actionSteps(name) {
	return parse(readFileSync(join(import.meta.dirname, `../../.github/actions/${name}/action.yml`), "utf8")).runs.steps;
}

describe("Desktop release workflow contracts", () => {
	it("downloads packaging inputs directly instead of restoring Actions caches", () => {
		expect(actionSteps("install-bun-dependencies").some((step) => step.uses?.startsWith("actions/cache"))).toBe(
			false,
		);
		expect(workflow).not.toContain("actions/cache");
		expect(workflow).not.toContain("desktop-download-cache");
		expect(workflow).not.toContain("prepare-desktop-resources");
		for (const job of [jobs.quality, jobs.build]) {
			const setupGo = job.steps.find((step) => step.uses === "actions/setup-go@v5");
			expect(setupGo.with.cache).toBe(false);
		}
	});

	it("publishes each platform's installers as soon as it is built", () => {
		expect(jobs.build.strategy["fail-fast"]).toBe(false);
		expect(Object.keys(jobs)).toEqual(["prepare", "quality", "build"]);
		expect(workflow).not.toContain("release-build-");
		expect(workflow).not.toContain("test:e2e:packaged");
		expect(workflow).not.toContain("download-artifact");
		expect(workflow).not.toContain("merge:updates:mac");
		const buildSteps = jobs.build.steps;
		const index = (name) => buildSteps.findIndex((step) => step.name === name);
		const build = index("Build updater artifacts");
		const verify = index("Verify updater artifacts");
		const rename = index("Name macOS update metadata per architecture");
		const upload = index("Upload updater artifacts");
		const r2 = index("Publish installers to R2 and stage update metadata");
		const github = index("Add installers to GitHub Release");
		expect(build).toBeLessThan(verify);
		expect(verify).toBeLessThan(rename);
		expect(rename).toBeLessThan(upload);
		expect(upload).toBeLessThan(r2);
		expect(r2).toBeLessThan(github);
		expect(buildSteps[upload].with.name).toBe("desktop-$" + "{{ matrix.platform }}");
		expect(buildSteps[verify].if).toContain("runner.os != 'Windows'");
		expect(jobs.build.permissions).toEqual({ contents: "write" });
	});

	// 更新清单决定客户端何时看到新版本，由开发者手动上线；CI 只上传安装包。
	it("never publishes update metadata to a live update source", () => {
		const buildSteps = jobs.build.steps;
		const r2 = buildSteps.find((step) => step.name === "Publish installers to R2 and stage update metadata");
		expect(r2.if).toContain("needs.prepare.outputs.release_target == 'r2'");
		expect(r2.run).toBe("node scripts/publish-update-artifacts-r2.mjs --stage-metadata");
		expect(workflow).not.toContain("publish:updates:r2");
		const github = buildSteps.find((step) => step.name === "Add installers to GitHub Release");
		expect(github.run).toContain("gh release upload");
		expect(github.run).not.toContain(".yml");
		expect(github.run).not.toContain("--draft");
		expect(workflow).not.toContain("verify-update-feed");
	});

	// 上线清单会让用户开始收到新版本，只能手动触发，并与构建使用同一套 R2 目标解析。
	it("promotes staged update metadata only through a manual workflow", () => {
		const promote = parse(
			readFileSync(join(import.meta.dirname, "../../.github/workflows/desktop-promote.yml"), "utf8"),
		);
		expect(Object.keys(promote.on)).toEqual(["workflow_dispatch"]);
		expect(promote.on.workflow_dispatch.inputs.version.required).toBe(true);
		expect(promote.on.workflow_dispatch.inputs.dry_run.default).toBe(false);
		const steps = promote.jobs.promote.steps;
		const resolve = steps.find((step) => step.name === "Resolve R2 update target");
		expect(resolve.env.INPUT_RELEASE_TARGET).toBe("r2");
		expect(resolve.run).toContain("resolve-desktop-release-config.mjs --export-env");
		const run = steps.find((step) => step.name === "Promote staged update metadata");
		expect(run.run).toContain("node scripts/promote-update-metadata-r2.mjs");
		expect(run.run).toContain("--dry-run");
		const attach = steps.find((step) => step.name === "Attach promoted metadata to GitHub Release");
		expect(attach.if).toContain("dry_run != 'true'");
		expect(attach.if).toContain("channel != 'test'");
	});

	it("runs quality and packaging tests before the platform matrix", () => {
		expect(workflow).toContain("  quality:");
		expect(workflow).toMatch(/run: bun run check:full\r?\n/);
		expect(workflow).toContain("run: bun run test:quality");
		expect(workflow).toContain("run: bun run verify:desktop:contracts");
		expect(workflow).toContain("run: bun run test:desktop:packaging");
		expect(workflow).toContain("needs: [prepare, quality]");
	});

	it("downloads and verifies the pinned Windows sandbox release before packaging", () => {
		const sandboxSteps = actionSteps("prepare-windows-sandbox");
		expect(sandboxSteps).toHaveLength(1);
		const [download] = sandboxSteps;
		expect(download.env.SANDBOX_REPOSITORY).toBe("openvetta/codex");
		expect(download.env.SANDBOX_TAG).toMatch(/^vetta-sandbox-v\d+\.\d+\.\d+$/);
		expect(download.env.SANDBOX_COMMIT).toMatch(/^[0-9a-f]{40}$/);
		expect(download.env.SANDBOX_ARCHIVE_SHA256).toMatch(/^[0-9a-f]{64}$/);
		expect(download.run).toContain("SHA-256 mismatch");
		expect(download.run).toContain("$manifest.commit -ne $env:SANDBOX_COMMIT");
		expect(download.run).toContain("--capabilities --json");
		expect(JSON.stringify(sandboxSteps)).not.toMatch(/cargo|rust-toolchain|actions\/checkout/);

		for (const buildSteps of [jobs.build.steps, packagedJobs.smoke.steps]) {
			const sandbox = buildSteps.findIndex((step) => step.uses === "./.github/actions/prepare-windows-sandbox");
			expect(sandbox).toBeGreaterThanOrEqual(0);
			expect(buildSteps[sandbox].if).toBe("runner.os == 'Windows'");
			expect(sandbox).toBeLessThan(buildSteps.findIndex((step) => step.name === "Set up Bun"));
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
		const releaseBuildJob = workflow.split("\n  build:\n")[1];
		for (const jobSource of [packagedSmokeJob, releaseBuildJob]) {
			expect(jobSource).toBeDefined();
			expect(jobSource).toContain("Set up Go for IM gateway");
			expect(jobSource).toContain("uses: actions/setup-go@v5");
			expect(jobSource).toContain("go-version-file: apps/im-gateway/go.mod");
		}
		expect(packagedSmokeJob).toContain("cache-dependency-path: apps/im-gateway/go.sum");
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
		const buildJob = workflow.slice(workflow.indexOf("\n  build:"));
		const timeout = Number(buildJob.match(/timeout-minutes: (\d+)/)?.[1]);
		expect(timeout).toBeGreaterThanOrEqual(120);
	});

	// R2 是更新源，GitHub Release 是对外的下载入口和版本说明归档。早先两个发布 job
	// 按 release_target 互斥，商业版发版在 GitHub 上什么都看不到。
	it("publishes a GitHub Release alongside R2 for every non-test channel", () => {
		expect(workflow).toContain("- name: Add installers to GitHub Release");
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
