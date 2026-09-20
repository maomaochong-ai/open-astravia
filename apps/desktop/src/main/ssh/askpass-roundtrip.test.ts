import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureAskpassAssets } from "./askpass-assets.js";
import {
	createSshAskpassChannel,
	type SshAskpassChannel,
	type SshAskpassRequest,
	type SshPromptAnswer,
} from "./askpass-server.js";

const run = promisify(execFile);

/**
 * 端到端验证 OpenSSH 与 Vetta 之间的 askpass 合同。
 *
 * 这条链路上全是只有真跑才会暴露的东西：生成的 shell 脚本有没有可执行位、路径带空格
 * 时引用对不对、答案是不是走 stdout、确认类提示是不是只看退出码。单元测试无法覆盖，
 * 而错了的表现是「连接一直挂到超时」，排查成本很高。
 */
describe.skipIf(process.platform === "win32")("askpass 与 OpenSSH 的合同", () => {
	let channel: SshAskpassChannel;
	let scriptPath: string;
	const resolver = vi.fn(
		async (_request: SshAskpassRequest): Promise<SshPromptAnswer> => ({
			ok: true,
			value: "s3cret",
		}),
	);

	beforeAll(async () => {
		// 目录名刻意带空格：生成的脚本必须正确引用路径。
		const home = await mkdtemp(join(tmpdir(), "vetta askpass "));
		vi.stubEnv("VETTA_HOME", home);
		channel = createSshAskpassChannel((request) => resolver(request));
		// 传 node 而不是 electron：脚本里的 ELECTRON_RUN_AS_NODE 对 node 无害，
		// 被测的是脚本本身的拼装与调用方式。
		scriptPath = ensureAskpassAssets(process.execPath).scriptPath;
	});

	afterEach(() => {
		resolver.mockClear();
	});

	function invoke(prompt: string, extraEnv: Record<string, string> = {}) {
		return run(scriptPath, [prompt], {
			env: {
				...process.env,
				VETTA_ASKPASS_SOCKET: channel.socketPath,
				VETTA_ASKPASS_TOKEN: channel.token,
				VETTA_ASKPASS_HOST: "h1",
				...extraEnv,
			},
		});
	}

	it("口令提示：答案走 stdout，退出码为 0", async () => {
		resolver.mockResolvedValueOnce({ ok: true, value: "s3cret" });

		const { stdout } = await invoke("me@build-01's password: ");

		// OpenSSH 读的就是 stdout 的第一行。
		expect(stdout.trim()).toBe("s3cret");
		expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ hostId: "h1", kind: "password" }));
	});

	it("把提示原文与主机标识带给主进程", async () => {
		const prompt = "Enter passphrase for key '/Users/me/.ssh/id_ed25519': ";
		resolver.mockResolvedValueOnce({ ok: true, value: "pp" });

		await invoke(prompt);

		expect(resolver).toHaveBeenCalledWith({ hostId: "h1", kind: "passphrase", prompt });
	});

	it("确认类提示：同意即退出 0，且不往 stdout 写东西", async () => {
		resolver.mockResolvedValueOnce({ ok: true });

		const { stdout } = await invoke("Are you sure you want to continue connecting (yes/no)?", {
			SSH_ASKPASS_PROMPT: "confirm",
		});

		expect(stdout).toBe("");
		expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ kind: "confirm" }));
	});

	it("用户拒绝时以非零退出，让 ssh 放弃本次认证", async () => {
		resolver.mockResolvedValueOnce({ ok: false });

		await expect(invoke("Are you sure (yes/no)?")).rejects.toMatchObject({ code: 1 });
	});

	it("token 不对一律拒绝", async () => {
		// socket 路径可能出现在进程列表里，光靠路径保密不够。
		await expect(invoke("password: ", { VETTA_ASKPASS_TOKEN: "wrong" })).rejects.toMatchObject({ code: 1 });
		expect(resolver).not.toHaveBeenCalled();
	});

	it("没有回传通道时拒绝，而不是静默放行", async () => {
		// 这里若退出 0，确认类提示就等于「默认同意」，中间人可以静默通过。
		await expect(invoke("Are you sure (yes/no)?", { VETTA_ASKPASS_SOCKET: "" })).rejects.toMatchObject({ code: 1 });
	});
});
