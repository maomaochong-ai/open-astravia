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
		expect(Object.keys(jobs)).toEqual([
			"prepare",
			"quality",
			"build",
			"publish-r2",
			"publish-website",
			"deploy-website",
			"promote",
		]);
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

	// 构建任务只上传安装包与暂存清单；清单上线集中在 desktop-promote。
	it("never publishes update metadata from a platform build", () => {
		const buildSteps = jobs.build.steps;
		const r2 = buildSteps.find((step) => step.name === "Publish installers to R2 and stage update metadata");
		expect(r2.if).toContain("needs.prepare.outputs.release_target == 'r2'");
		expect(r2.run).toBe("node scripts/publish-update-artifacts-r2.mjs --stage-metadata");
		expect(workflow).not.toContain("publish:updates:r2");
		const github = buildSteps.find((step) => step.name === "Add installers to GitHub Release");
		expect(github.run).toContain("publish-github-installers.mjs --platform desktop");
		expect(github.run).not.toContain(".yml");
		expect(github.run).not.toContain("--draft");
		expect(workflow).not.toContain("verify-update-feed");
	});

	// 上线清单会让用户开始收到新版本：全部平台成功后自动调用，也保留手动入口，
	// 并与构建使用同一套 R2 目标解析。
	it("promotes staged update metadata through one reusable workflow", () => {
		const promote = parse(
			readFileSync(join(import.meta.dirname, "../../.github/workflows/desktop-promote.yml"), "utf8"),
		);
		expect(Object.keys(promote.on).sort()).toEqual(["workflow_call", "workflow_dispatch"]);
		for (const trigger of ["workflow_call", "workflow_dispatch"]) {
			expect(promote.on[trigger].inputs.version.required).toBe(true);
			expect(promote.on[trigger].inputs.dry_run.default).toBe(false);
		}
		expect(promote.jobs.promote.concurrency.group).toBe("desktop-promote-$" + "{{ inputs.channel }}");
		const steps = promote.jobs.promote.steps;
		const resolve = steps.find((step) => step.name === "Resolve R2 update target");
		expect(resolve.env.INPUT_RELEASE_TARGET).toBe("r2");
		expect(resolve.env.VAR_RELEASE_CHANNEL).toBe("$" + "{{ vars.ASTRAVIA_RELEASE_CHANNEL }}");
		expect(resolve.run).toContain("resolve-desktop-release-config.mjs --export-env");
		const run = steps.find((step) => step.name === "Promote staged update metadata");
		expect(run.run).toContain("node scripts/promote-update-metadata-r2.mjs");
		expect(run.run).toContain("--dry-run");
		const attach = steps.find((step) => step.name === "Attach promoted metadata to GitHub Release");
		expect(attach.if).toContain("!inputs.dry_run");
		expect(attach.if).toContain("inputs.channel != 'test'");
		expect(JSON.stringify(promote)).not.toContain("github.event.inputs");
	});

	// 官网下载按钮指向 R2 直链，上传、改版本号、部署必须由流水线自己按顺序完成；
	// 任何一步重新变成人工接力，就会重新出现「页面指向上一版」或「点下去 404」。
	it("carries a release from R2 through the website version to the deployed site", () => {
		const r2 = jobs["publish-r2"];
		expect(r2.needs).toEqual(["prepare", "build"]);
		expect(r2.uses).toBe("./.github/workflows/upload-release-to-r2.yml");
		expect(r2.with.version).toBe("$" + "{{ needs.prepare.outputs.release-version }}");
		expect(r2.secrets).toBe("inherit");
		// 手机端产物在 client-mobile-release 里，桌面这条链只跑自己的构建；也不在测试渠道里跑。
		for (const name of ["publish-r2", "publish-website", "deploy-website"]) {
			expect(jobs[name].if).toContain("needs.prepare.outputs.should-publish == 'true'");
			expect(jobs[name].if).toContain("needs.prepare.outputs.release_target == 'github'");
			expect(jobs[name].if).toContain("needs.prepare.outputs.channel != 'test'");
			expect(jobs[name].if).not.toContain("always()");
		}
		// 同一个 Release 上还有手机端 IPA / APK，桌面只拉自己的格式；这份清单必须与
		// publish-github-installers 的桌面白名单一致，否则新增格式会静默传不上 CDN。
		expect(r2.with.patterns).toBe("*.AppImage,*.blockmap,*.deb,*.dmg,*.exe,*.msi,*.rpm,*.zip");
		const installerScript = readFileSync(
			join(import.meta.dirname, "../../scripts/release/publish-github-installers.mjs"),
			"utf8",
		);
		const desktopFormats = installerScript.match(/desktop: new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
		const extensions = desktopFormats.match(/"\.[\w.]+"/g) ?? [];
		expect(extensions.length).toBeGreaterThan(0);
		for (const extension of extensions) {
			expect(r2.with.patterns).toContain(`*${extension.slice(1, -1)}`);
		}
		const website = jobs["publish-website"];
		expect(website.needs).toEqual(["prepare", "publish-r2"]);
		expect(website.permissions).toEqual({ contents: "write", "pull-requests": "write" });
		expect(website.outputs.ref).toBe("$" + "{{ steps.publish.outputs.ref }}");
		const bump = website.steps.find((step) => step.name?.startsWith("Bump website version"));
		expect(bump.run).toContain("node scripts/release/bump-website-version.mjs --version");
		expect(bump.run).toContain("git push --force origin");
		expect(bump.run).toContain("refs/heads/");
		expect(bump.run).toContain("gh pr create --base dev");
		// 无人值守时不做自动合并：main 的版本号跟进必须由人看过 diff 再结合。
		expect(bump.run).not.toContain("--auto");

		// 上线内容只取 main：版本分支从 dev 派生，dev 落后时会把旧首页发到生产
		// （0.5.77 就因此丢了知识库/定价/FAQ）。部署 ref 必须从 origin/main 派生。
		expect(bump.env.DEPLOY_BRANCH).toBe("release/website-deploy-v$" + "{{ needs.prepare.outputs.release-version }}");
		const deployRef = "$" + "{DEPLOY_BRANCH}";
		const githubOutput = "$" + "{GITHUB_OUTPUT}";
		expect(bump.run).toContain(`git switch -C "${deployRef}" origin/main`);
		expect(bump.run).toContain(`git push --force origin "HEAD:refs/heads/${deployRef}"`);
		expect(bump.run).toContain(`echo "ref=${deployRef}" >> "${githubOutput}"`);
		const deploy = jobs["deploy-website"];
		expect(deploy.needs).toEqual(["prepare", "publish-website"]);
		expect(deploy.uses).toBe("./.github/workflows/deploy-website.yml");
		expect(deploy.with.ref).toBe("$" + "{{ needs.publish-website.outputs.ref }}");
		expect(deploy.secrets).toBe("inherit");
		// workflow_call 只能降不能升：被调 workflow 声明的 scope 必须在这里先授出来，
		// 否则运行一开始就失败。
		expect(deploy.permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
	});

	it("exposes the R2 and website workflows as reusable workflows", () => {
		const r2 = parse(
			readFileSync(join(import.meta.dirname, "../../.github/workflows/upload-release-to-r2.yml"), "utf8"),
		);
		expect(r2.on.workflow_call.inputs.version.required).toBe(true);
		expect(r2.on.workflow_call.inputs.prefix.default).toBe("");
		expect(r2.jobs.upload.steps.some((step) => step.name === "Upload assets to R2")).toBe(true);

		const site = parse(readFileSync(join(import.meta.dirname, "../../.github/workflows/deploy-website.yml"), "utf8"));
		expect(site.on.workflow_call.inputs.ref.default).toBe("");
		const checkout = site.jobs.deploy.steps.find((step) => step.uses?.startsWith("actions/checkout"));
		expect(checkout.with.ref).toBe("$" + "{{ inputs.ref || github.ref }}");
	});
	it("promotes automatically only after every platform build succeeds", () => {
		expect(jobs.promote.needs).toEqual(["prepare", "build"]);
		expect(jobs.promote.uses).toBe("./.github/workflows/desktop-promote.yml");
		expect(jobs.promote.if).toContain("needs.prepare.outputs.should-publish == 'true'");
		expect(jobs.promote.if).toContain("needs.prepare.outputs.release_target == 'r2'");
		expect(jobs.promote.if).toContain("github.event.inputs.auto_promote != 'false'");
		expect(jobs.promote.if).not.toContain("always()");
		expect(jobs.promote.if).not.toContain("failure()");
		expect(jobs.promote.with.version).toBe("$" + "{{ needs.prepare.outputs.release-version }}");
		expect(jobs.promote.with.channel).toBe("$" + "{{ needs.prepare.outputs.channel }}");
		expect(jobs.promote.secrets).toBe("inherit");
		expect(jobs.promote.permissions).toEqual({ contents: "write" });
		expect(parse(workflow).on.workflow_dispatch.inputs.auto_promote.default).toBe(true);
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
		expect(download.env.SANDBOX_REPOSITORY).toBe("maomaochong-ai/codex");
		expect(download.env.SANDBOX_TAG).toMatch(/^astravia-sandbox-v\d+\.\d+\.\d+$/);
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
		const github = jobs.build.steps.find((step) => step.name === "Add installers to GitHub Release");
		expect(github.env.RELEASE_VERSION).toBe("$" + "{{ needs.prepare.outputs.release-version }}");
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
		expect(workflow).not.toContain("astravia-mac");
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
		expect(workflow).toContain("node scripts/release/publish-github-installers.mjs");
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
