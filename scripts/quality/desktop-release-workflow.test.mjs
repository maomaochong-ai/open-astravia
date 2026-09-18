import { readFileSync } from "node:fs";
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

describe("Desktop release workflow contracts", () => {
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
	});

	it("runs packaged boot and updater E2E on every release platform", () => {
		expect(workflow).toContain("Run packaged app and updater E2E");
		expect(workflow).toContain('VETTA_E2E_UPDATE_FEED: "1"');
		expect(workflow).toContain("xvfb-run --auto-servernum bun run test:e2e:packaged");
		const initialVerify = workflow.indexOf("- name: Verify platform updater artifacts");
		const packagedE2e = workflow.indexOf("- name: Run packaged app and updater E2E");
		const finalVerify = workflow.indexOf("- name: Re-verify platform updater artifacts after packaged E2E");
		const upload = workflow.indexOf("- name: Upload updater artifacts");
		expect(initialVerify).toBeLessThan(packagedE2e);
		expect(packagedE2e).toBeLessThan(finalVerify);
		expect(finalVerify).toBeLessThan(upload);
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

	it("builds, verifies, installs, and uploads all Linux release formats", () => {
		expect(workflow).toContain("command: dist:linux");
		expect(workflow).toContain("verify: verify:updates:linux:release");
		expect(workflow).toContain("pkg-config xz-utils rpm");
		expect(workflow).toContain("Verify native Linux package installation");
		expect(workflow).toContain("ubuntu:24.04");
		expect(workflow).toContain("fedora:latest");
		expect(workflow).toContain("dnf install --assumeyes --nogpgcheck");
		expect(workflow).toContain('test "$(cat /opt/Vetta/resources/package-type)" = "deb"');
		expect(workflow).toContain('test "$(cat /opt/Vetta/resources/package-type)" = "rpm"');
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

	it("builds, verifies, and uploads all Windows release formats", () => {
		expect(workflow).toContain("command: dist:win");
		expect(workflow).toContain("verify: verify:updates:windows");
		expect(workflow).toContain("Verify supplemental Windows packages");
		expect(workflow).toContain("run: bun run verify:packages:windows");
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
		const releaseBuildJob = workflow.split("\n  build:\n")[1]?.split("\n  publish-github:\n")[0];
		for (const jobSource of [packagedSmokeJob, releaseBuildJob]) {
			expect(jobSource).toBeDefined();
			expect(jobSource).toContain("Install Linux Electron runtime dependencies");
			expect(jobSource).toContain("libasound2t64");
		}
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
