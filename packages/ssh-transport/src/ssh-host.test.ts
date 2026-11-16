import { describe, expect, it } from "vitest";
import { buildSshArgv } from "./ssh-argv.js";
import { normalizeSshHostInput } from "./ssh-host.js";

describe("密码登录", () => {
	it("记录认证方式并丢弃私钥路径", () => {
		const host = normalizeSshHostInput({ label: "a", target: "u@h", authMethod: "password", identityFile: "~/k" });
		expect(host.authMethod).toBe("password");
		expect(host.identityFile).toBeUndefined();
	});

	it("私钥登录不写入 authMethod", () => {
		expect(normalizeSshHostInput({ label: "a", target: "h", authMethod: "key" }).authMethod).toBeUndefined();
	});

	it("私钥登录仍保留私钥路径", () => {
		expect(normalizeSshHostInput({ label: "a", target: "h", identityFile: "~/k" }).identityFile).toBe("~/k");
	});

	it("argv 只尝试口令类认证，不先试本机私钥", () => {
		const argv = buildSshArgv(
			{ id: "1", label: "a", target: "h", source: "manual", authMethod: "password" },
			{ controlPath: "/tmp/c" },
		);
		expect(argv).toContain("PubkeyAuthentication=no");
		expect(argv).toContain("PreferredAuthentications=password,keyboard-interactive");
	});

	it("私钥登录不注入口令相关选项", () => {
		const argv = buildSshArgv({ id: "1", label: "a", target: "h", source: "manual" }, { controlPath: "/tmp/c" });
		expect(argv.some((value) => value.startsWith("PreferredAuthentications="))).toBe(false);
		expect(argv).not.toContain("PubkeyAuthentication=no");
	});

	it("缺省启用 ControlMaster 连接复用", () => {
		const argv = buildSshArgv({ id: "1", label: "a", target: "h", source: "manual" }, { controlPath: "/tmp/c" });
		expect(argv).toContain("ControlMaster=auto");
		expect(argv).toContain("ControlPath=/tmp/c");
		expect(argv).toContain("ControlPersist=600");
	});

	it("Windows 关闭 ControlMaster 时不再传 socket 相关选项", () => {
		// Windows OpenSSH 不支持 Unix domain socket 语义的 ControlPath，会报 getsockname failed。
		const argv = buildSshArgv(
			{ id: "1", label: "a", target: "h", source: "manual" },
			{ controlPath: "/tmp/c", controlMaster: false },
		);
		expect(argv).not.toContain("ControlMaster=auto");
		expect(argv).not.toContain("ControlPath=/tmp/c");
		expect(argv).not.toContain("ControlPersist=600");
		expect(argv).toContain("ConnectTimeout=15");
	});
});
