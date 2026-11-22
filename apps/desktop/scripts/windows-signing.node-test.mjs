import assert from "node:assert/strict";
import test from "node:test";
import { buildOsslSigncodeArgs, buildSignToolArgs, buildVerifyArgs, signWindowsFiles } from "./windows-sign.mjs";
import { resolveWindowsSigningConfig } from "./windows-signing-config.mjs";

test("resolveWindowsSigningConfig stays disabled without credentials", () => {
	assert.equal(resolveWindowsSigningConfig({}).enabled, false);
	assert.equal(resolveWindowsSigningConfig({ APPLE_TEAM_ID: "TEAM" }).enabled, false);
});

test("resolveWindowsSigningConfig rejects half-configured PFX credentials", () => {
	// 只有密码没有 PFX，属于「看起来配了其实签不了」，必须直接失败。
	assert.throws(() => resolveWindowsSigningConfig({ WIN_CSC_KEY_PASSWORD: "secret" }), /WIN_CSC_LINK/);
	assert.throws(() => resolveWindowsSigningConfig({ WIN_CSC_LINK: "C:/cert.pfx" }), /WIN_CSC_KEY_PASSWORD/);
});

test("resolveWindowsSigningConfig accepts PFX, store thumbprint and CI enforcement", () => {
	const pfx = resolveWindowsSigningConfig({
		WIN_CSC_LINK: "C:/certs/astravia.pfx",
		WIN_CSC_KEY_PASSWORD: "secret",
	});
	assert.equal(pfx.enabled, true);
	assert.equal(pfx.certificateFile, "C:/certs/astravia.pfx");
	assert.equal(pfx.timestampUrl, "http://timestamp.digicert.com");

	const store = resolveWindowsSigningConfig({ ASTRAVIA_WINDOWS_SIGN_SHA1: "ABCDEF" });
	assert.equal(store.certificateSha1, "ABCDEF");

	// 发布流水线：要求签名却没配凭据 → 直接失败，不产出未签名安装包。
	assert.throws(
		() => resolveWindowsSigningConfig({ ASTRAVIA_REQUIRE_WINDOWS_SIGNATURE: "1" }),
		/docs\/deploy\/windows-code-signing\.md/,
	);
});

test("signtool arguments carry sha256 digest, timestamp and certificate", () => {
	const args = buildSignToolArgs({
		file: "C:/out/Astravia.exe",
		certificatePath: "C:/cert.pfx",
		certificatePassword: "secret",
		timestampUrl: "http://timestamp.digicert.com",
	});
	assert.deepEqual(args, [
		"sign",
		"/fd",
		"sha256",
		"/td",
		"sha256",
		"/tr",
		"http://timestamp.digicert.com",
		"/f",
		"C:/cert.pfx",
		"/p",
		"secret",
		"C:/out/Astravia.exe",
	]);
	assert.deepEqual(buildVerifyArgs("signtool", "C:/out/Astravia.exe"), [
		"verify",
		"/pa",
		"/all",
		"C:/out/Astravia.exe",
	]);
});

test("osslsigncode keeps the original file readable for the signature output", () => {
	const args = buildOsslSigncodeArgs({
		file: "/tmp/Astravia.exe",
		certificatePath: "/tmp/cert.pfx",
		certificatePassword: "secret",
		timestampUrl: "http://timestamp.digicert.com",
		signedPath: "/tmp/Astravia.exe.signed",
	});
	assert.deepEqual(args, [
		"sign",
		"-pkcs12",
		"/tmp/cert.pfx",
		"-h",
		"sha256",
		"-t",
		"http://timestamp.digicert.com",
		"-pass",
		"secret",
		"-in",
		"/tmp/Astravia.exe",
		"-out",
		"/tmp/Astravia.exe.signed",
	]);
});

test("signWindowsFiles signs and then verifies every file", async () => {
	const calls = [];
	const run = (command, args) => {
		calls.push([command, args]);
	};

	const result = await signWindowsFiles(["C:/out/versions/1.0.0/Astravia.exe", "C:/out/Astravia.exe"], {
		config: {
			enabled: true,
			// 用证书指纹走证书存储，避免测试依赖真实 PFX 文件。
			certificateSha1: "ABCDEF",
			certificatePassword: "secret",
			timestampUrl: "http://timestamp.digicert.com",
		},
		run,
		resolveTool: () => "signtool",
	});

	assert.equal(result.tool, "signtool");
	assert.equal(result.signed.length, 2);
	// 每个文件：一次 sign，一次 verify；顺序固定，避免「签了但没验证」。
	assert.deepEqual(
		calls.map(([command, args]) => `${command}:${args[0]}`),
		["signtool.exe:sign", "signtool.exe:verify", "signtool.exe:sign", "signtool.exe:verify"],
	);
});

test("signWindowsFiles is a no-op when signing is disabled", async () => {
	const result = await signWindowsFiles(["C:/out/Astravia.exe"], { config: { enabled: false } });
	assert.deepEqual(result, { signed: [], skipped: "disabled" });
});
