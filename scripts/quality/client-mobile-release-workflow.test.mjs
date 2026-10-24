import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 手机端产物走独立的 client-mobile-release 流水线，与桌面专用的 desktop-release 并行：
 * 一次 tag 推送要让 GitHub Release 带上 IPA / APK，同时把这两个文件送进 R2 的
 * client-mobile/，官网按钮才点得动。这里把整条链路钉住，防止哪天为了「统一发布」
 * 又把它塞回桌面流水线，或者反过来把手机 job 当成桌面专属顺手删掉。
 */
const workflow = readFileSync(join(import.meta.dirname, "../../.github/workflows/client-mobile-release.yml"), "utf8");
const desktopWorkflow = readFileSync(join(import.meta.dirname, "../../.github/workflows/desktop-release.yml"), "utf8");
const r2Workflow = readFileSync(join(import.meta.dirname, "../../.github/workflows/upload-release-to-r2.yml"), "utf8");

const require = createRequire(join(import.meta.dirname, "../../apps/desktop/package.json"));
const { parse } = require("yaml");
const parsed = parse(workflow);
const jobs = parsed.jobs;
const r2Inputs = parse(r2Workflow).on.workflow_call.inputs;

describe("Mobile release workflow contracts", () => {
	it("keeps the phone pipeline separate from the desktop release", () => {
		expect(Object.keys(jobs)).toEqual(["prepare", "quality", "android", "ios", "publish-r2"]);
		// 桌面流水线里不该再有手机端的 job：桌面签名公证动辄两小时，
		// 不该被 Android 密钥缺失或 iOS 归档失败拖住，反之亦然。
		const desktopJobs = parse(desktopWorkflow).jobs;
		for (const name of ["android", "ios", "publish-mobile-r2"]) {
			expect(desktopJobs).not.toHaveProperty(name);
		}
		// 也不能反过来靠 Release 事件接力：GITHUB_TOKEN 创建的 Release 不会触发 workflow。
		expect(parsed.on).toHaveProperty("push");
		expect(parsed.on).toHaveProperty("workflow_dispatch");
		expect(parsed.on.workflow_dispatch.inputs.tag.required).toBe(true);
	});

	it("publishes only for a tag that matches the release version", () => {
		const prepare = jobs.prepare;
		expect(prepare.outputs["should-publish"]).toBe("$" + "{{ steps.scope.outputs.should-publish }}");
		expect(prepare.outputs["release-version"]).toBe("$" + "{{ steps.scope.outputs.release-version }}");
		// 构建与发布都要落到 tag 本身，手动重发时才能复现同一版产物。
		expect(prepare.outputs.tag).toBe("$" + "{{ steps.scope.outputs.tag }}");
		const scope = prepare.steps.find((step) => step.id === "scope");
		expect(scope.run).toContain("apps/desktop/package.json");
		expect(scope.run).toContain(`"v\${VERSION}"`);
		expect(scope.run).toContain("should-publish=false");
		for (const job of [jobs.quality, jobs.android, jobs.ios]) {
			expect(job.steps[0].with.ref).toBe("$" + "{{ needs.prepare.outputs.tag }}");
		}
	});

	it("builds the iOS IPA on a macOS runner", () => {
		const ios = jobs.ios;
		expect(ios["runs-on"]).toBe("macos-26");
		expect(ios.needs).toEqual(["prepare", "quality"]);
		expect(ios.if).toBe("needs.prepare.outputs.should-publish == 'true'");
		// IPA 要挂到 Release 上，必须有写权限；未签名不需要任何密钥，因此不设 environment。
		expect(ios.permissions).toEqual({ contents: "write" });
		expect(ios.environment).toBeUndefined();

		const steps = ios.steps;
		const names = steps.map((step) => step.name);
		expect(names).toContain("Generate the Xcode project");
		expect(names).toContain("Build unsigned IPA");
		expect(names).toContain("Upload IPA");
		expect(names).toContain("Add IPA to GitHub Release");

		const generate = steps.find((step) => step.name === "Generate the Xcode project");
		expect(generate.run).toContain("xcodegen generate");
		const build = steps.find((step) => step.name === "Build unsigned IPA");
		expect(build.run).toBe("scripts/build-ios-ipa.sh");
		expect(build["working-directory"]).toBe("apps/mobile/client-apple");

		const publish = steps.find((step) => step.name === "Add IPA to GitHub Release");
		expect(publish.run).toContain("--platform ios");
		expect(publish.env.RELEASE_VERSION).toBe("$" + "{{ needs.prepare.outputs.release-version }}");
	});

	it("builds Android with its own version and publishes the APK to the same release", () => {
		const android = jobs.android;
		expect(android.needs).toEqual(["prepare", "quality"]);
		expect(android.if).toBe("needs.prepare.outputs.should-publish == 'true'");
		// 签名凭据挂在 desktop-production 环境上，手机端发布复用同一组凭据。
		expect(android.environment).toBe("desktop-production");
		expect(android.permissions).toEqual({ contents: "write" });
		const steps = android.steps;
		const index = (name) => steps.findIndex((step) => step.name === name);
		const prepare = steps[index("Prepare Android release signing")];
		expect(prepare.env).not.toHaveProperty("RELEASE_VERSION");
		expect(prepare.id).toBe("android-signing");
		for (const name of [
			"ASTRAVIA_ANDROID_KEYSTORE_BASE64",
			"ASTRAVIA_ANDROID_KEYSTORE_PASSWORD",
			"ASTRAVIA_ANDROID_KEY_ALIAS",
			"ASTRAVIA_ANDROID_KEY_PASSWORD",
		]) {
			expect(prepare.env[name]).toBe(`${"$"}{{ secrets.${name} }}`);
		}
		expect(steps.find((step) => step.uses === "gradle/actions/setup-gradle@v4").with["cache-disabled"]).toBe(true);
		expect(steps[index("Test Android host logic")].run).toContain(":shared:testAndroidHostTest");
		expect(steps[index("Build signed Android release APK")].run).toContain(
			"-PastraviaSplitApks=true :androidApp:assembleRelease",
		);
		expect(steps[index("Verify and name signed Android APK")].run).toContain('apksigner" verify');
		expect(steps[index("Upload signed Android APK")].with.path).toBe("$" + "{{ env.ASTRAVIA_ANDROID_APK_PATH }}");
		const publish = steps[index("Add Android APK to GitHub Release")];
		expect(publish.env.RELEASE_VERSION).toBe("$" + "{{ needs.prepare.outputs.release-version }}");
		expect(publish.run).toContain("publish-github-installers.mjs --platform android");
		expect(index("Test Android host logic")).toBeLessThan(index("Build signed Android release APK"));
		expect(index("Build signed Android release APK")).toBeLessThan(index("Verify and name signed Android APK"));
		expect(index("Verify and name signed Android APK")).toBeLessThan(index("Add Android APK to GitHub Release"));
		expect(steps[index("Clean Android signing key")].if).toBe("always()");
		// 缺少签名凭据时整条签名链路都不跑，但主机测试仍要守住发布质量。
		const signingGate = "steps.android-signing.outputs.android_signing_available == 'true'";
		for (const name of [
			"Build signed Android release APK",
			"Verify and name signed Android APK",
			"Upload signed Android APK",
			"Add Android APK to GitHub Release",
		]) {
			expect(steps[index(name)].if).toBe(signingGate);
		}
		expect(steps[index("Test Android host logic")].if).toBeUndefined();
		const gradle = readFileSync(
			join(import.meta.dirname, "../../apps/mobile/client-android/androidApp/build.gradle.kts"),
			"utf8",
		);
		expect(gradle).toContain('signingConfig = signingConfigs.getByName("release")');
		expect(gradle).toContain('it.name == "preReleaseBuild"');
		expect(gradle).toContain("dependsOn(validateAstraviaReleaseSigning)");
		expect(gradle).toContain('providers.gradleProperty("astraviaAndroidVersionName")');
		expect(gradle).toContain('providers.gradleProperty("astraviaAndroidVersionCode")');
		expect(gradle).toContain('include(providers.gradleProperty("astraviaAndroidAbi").get())');
		expect(
			readFileSync(join(import.meta.dirname, "../../apps/mobile/client-android/gradle.properties"), "utf8"),
		).toMatch(/^astraviaAndroidAbi=arm64-v8a\r?$/m);
		expect(gradle).toContain('providers.gradleProperty("astraviaSplitApks").orElse("false")');
		expect(gradle).not.toContain("ASTRAVIA_ANDROID_VERSION_NAME");
	});

	it("uploads mobile installers to the stable client-mobile prefix", () => {
		const mobile = jobs["publish-r2"];
		expect(mobile.uses).toBe("./.github/workflows/upload-release-to-r2.yml");
		expect(mobile.needs).toEqual(["prepare", "ios", "android"]);
		expect(mobile.with.prefix).toBe("client-mobile");
		expect(mobile.with.patterns).toBe("*.ipa,*.apk");
		expect(mobile.with.version).toBe("$" + "{{ needs.prepare.outputs.release-version }}");
		expect(mobile.secrets).toBe("inherit");
		// android 任务在缺签名密钥时会整条跳过，所以必须容忍 skipped 的依赖。
		expect(mobile.if).toContain("always()");
		expect(mobile.if).toContain("needs.ios.result == 'success' || needs.android.result == 'success'");
	});

	it("keeps the R2 upload reusable by letting callers filter release assets", () => {
		expect(r2Inputs.patterns.type).toBe("string");
		expect(r2Inputs.patterns.default).toBe("");
		expect(r2Workflow).toContain("PATTERNS");
		// 过滤后仍要有兜底：一个都没下到就直接失败，不能拿空目录去覆盖 R2。
		expect(r2Workflow).toContain("No release asset matched");
		// 桌面与手机对同一个 tag 各调一次本 workflow，并发组必须区分前缀，否则
		// cancel-in-progress 会让两次上传互相取消，后到的那条把先到的干掉。
		const r2Concurrency = parse(r2Workflow)?.concurrency?.group ?? "";
		expect(r2Concurrency).toContain("inputs.prefix");
	});
});
