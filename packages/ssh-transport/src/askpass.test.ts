import { describe, expect, it } from "vitest";
import { buildAskpassEnvironment, classifySshPrompt, isRememberableSshPrompt } from "./askpass.js";

describe("classifySshPrompt", () => {
	it("OpenSSH 8.4+ 明说是确认时直接采信", () => {
		expect(classifySshPrompt("Allow access to your key?", "confirm")).toBe("confirm");
	});

	it("识别首次连接的主机指纹核对", () => {
		// 这类提示必须由用户确认；默认放行等于让中间人静默通过。
		const prompt =
			"The authenticity of host 'build-01 (10.0.0.1)' can't be established.\n" +
			"ED25519 key fingerprint is SHA256:abc.\n" +
			"Are you sure you want to continue connecting (yes/no/[fingerprint])?";
		expect(classifySshPrompt(prompt)).toBe("confirm");
	});

	it("区分私钥密码与远端账号口令", () => {
		expect(classifySshPrompt("Enter passphrase for key '/Users/me/.ssh/id_ed25519': ")).toBe("passphrase");
		expect(classifySshPrompt("me@build-01's password: ")).toBe("password");
	});

	it("识别一次性验证码", () => {
		expect(classifySshPrompt("Verification code: ")).toBe("verification-code");
		expect(classifySshPrompt("Enter your OTP: ")).toBe("verification-code");
	});

	it("同时含验证码与 password 字样时判为验证码", () => {
		// 某些 PAM 配置会把两者拼在一句里；判成 password 会把一次性码当长期凭据记住。
		expect(classifySshPrompt("Password or verification code: ")).toBe("verification-code");
	});

	it("认不出来的提示按口令处理，而不是当成确认放行", () => {
		expect(classifySshPrompt("Something unexpected: ")).toBe("password");
	});
});

describe("isRememberableSshPrompt", () => {
	it("只记住长期凭据", () => {
		expect(isRememberableSshPrompt("password")).toBe(true);
		expect(isRememberableSshPrompt("passphrase")).toBe(true);
	});

	it("一次性验证码与确认不可记住", () => {
		// 记住一次性码没有意义，还会把它留在磁盘上。
		expect(isRememberableSshPrompt("verification-code")).toBe(false);
		expect(isRememberableSshPrompt("confirm")).toBe(false);
	});
});

describe("buildAskpassEnvironment", () => {
	it("强制走 askpass，不依赖 tty", () => {
		expect(buildAskpassEnvironment("/tmp/askpass.sh").SSH_ASKPASS_REQUIRE).toBe("force");
	});

	it("没有 DISPLAY 时补一个，照顾不认 SSH_ASKPASS_REQUIRE 的老版本", () => {
		expect(buildAskpassEnvironment("/tmp/askpass.sh").DISPLAY).toBe(":0");
	});

	it("已有 DISPLAY 时不覆盖用户的值", () => {
		expect(buildAskpassEnvironment("/tmp/askpass.sh", ":1").DISPLAY).toBeUndefined();
	});
});
