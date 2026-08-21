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

	it("uses hosted macOS runners only for non-publishing rehearsals", () => {
		expect(workflow).toContain(
			"runs-on: $" +
				"{{ needs.prepare.outputs.should-publish == 'true' && matrix.releaseRunner || matrix.rehearsalRunner }}",
		);
		expect(workflow.match(/releaseRunner: vetta-mac/g)).toHaveLength(2);
		expect(workflow).toContain("rehearsalRunner: macos-15\n");
		expect(workflow).toContain("rehearsalRunner: macos-15-intel\n");
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
