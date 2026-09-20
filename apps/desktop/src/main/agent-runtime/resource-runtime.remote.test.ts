import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeSshProcessRunner, SshConnection } from "@vetta/ssh-transport";
import { describe, expect, it, vi } from "vitest";

/**
 * 顶替 `ssh` 的脚本只认最后一个参数，并把它交给本机 /bin/sh——这正是 sshd 对远端命令
 * 做的事。于是「远端」就是本机的一个临时目录，命令构造与解析都跑在真实 shell 上。
 */
function createLoopbackConnection(): SshConnection {
	const directory = mkdtempSync(join(tmpdir(), "vetta-loopback-ssh-"));
	const fakeSsh = join(directory, "ssh");
	writeFileSync(fakeSsh, '#!/bin/sh\nfor last; do :; done\nexec /bin/sh -c "$last"\n');
	chmodSync(fakeSsh, 0o755);
	return new SshConnection(
		{ id: "build-01", label: "build-01", target: "build-01", source: "manual" },
		{
			runner: createNodeSshProcessRunner({ sshBinary: fakeSsh, baseEnv: { ...process.env, SHELL: "/bin/sh" } }),
			controlPath: join(directory, "cp"),
		},
	);
}

const connection = createLoopbackConnection();
vi.mock("../ssh/ssh-runtime.js", () => ({ getSshConnection: () => connection }));

const { createDesktopPromptRuntimeSources } = await import("./resource-runtime.js");

describe("远程项目会话的资源发现", () => {
	it("读到远端项目自己的 AGENTS.md 与项目技能，不读本机的", async () => {
		const remoteRoot = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-project-")));
		mkdirSync(join(remoteRoot, ".agents/skills/deploy"), { recursive: true });
		writeFileSync(join(remoteRoot, "AGENTS.md"), "REMOTE-PROJECT-RULES\n");
		writeFileSync(
			join(remoteRoot, ".agents/skills/deploy/SKILL.md"),
			"---\nname: deploy\ndescription: Deploy the remote service.\n---\n\nRun the deploy script.\n",
		);
		const agentDir = mkdtempSync(join(tmpdir(), "vetta-agent-dir-"));

		const { resourceSource } = await createDesktopPromptRuntimeSources({
			cwd: `ssh://build-01${remoteRoot}`,
			agentDir,
			sessionOptions: { includeAgentSkills: true },
			runtimeSkillPaths: [],
		} as never);

		const agentsFiles = resourceSource.getAgentsFiles().agentsFiles;
		expect(agentsFiles.map((file) => file.content)).toContain("REMOTE-PROJECT-RULES\n");
		// 这条测试自己就跑在一个带 AGENTS.md 的仓库里：旧实现会把 URI 解析到进程 cwd 之下，
		// 再沿本机祖先目录向上，把本仓库的 AGENTS.md 当成远端项目的规则读进来。
		expect(agentsFiles.every((file) => file.path.startsWith(remoteRoot) || file.path.startsWith(agentDir))).toBe(
			true,
		);
		const deploy = resourceSource.getSkills().skills.find((skill) => skill.name === "deploy");
		// 模型会把这条路径直接交给跑在远端的 bash：必须是那台机器上的绝对路径，不是 URI。
		expect(deploy?.baseDir).toBe(join(remoteRoot, ".agents/skills/deploy"));
		expect(deploy?.filePath).toBe(join(remoteRoot, ".agents/skills/deploy/SKILL.md"));
	});
});
