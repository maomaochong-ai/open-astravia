import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse } from "node:path";
import {
	createLoopbackSshConnection,
	formatLoopbackProjectUri,
	toLoopbackRemotePath,
} from "@vetta/ssh-transport/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

const connection = createLoopbackSshConnection();
vi.mock("../ssh/ssh-runtime.js", () => ({ getSshConnection: () => connection }));

const { createDesktopPromptRuntimeSources } = await import("./resource-runtime.js");

describe("远程项目会话的资源发现", () => {
	let windowsFixture: string | undefined;
	afterEach(() => {
		vi.unstubAllEnvs();
		if (!windowsFixture) return;
		if (
			dirname(windowsFixture) !== parse(tmpdir()).root ||
			!basename(windowsFixture).startsWith("vetta-remote-project-")
		) {
			throw new Error(`Unexpected loopback fixture path: ${windowsFixture}`);
		}
		rmSync(windowsFixture, { recursive: true, force: true });
		windowsFixture = undefined;
	});
	it("读到远端项目自己的 AGENTS.md 与项目技能，不读本机的", async () => {
		const testHome = mkdtempSync(join(tmpdir(), "vetta-resource-home-"));
		vi.stubEnv("VETTA_HOME", testHome);
		vi.stubEnv(process.platform === "win32" ? "USERPROFILE" : "HOME", testHome);
		// Keep the loopback project outside the developer's home directory on Windows:
		// discovery walks ancestors, which may contain a large personal .agents tree.
		const fixtureParent = process.platform === "win32" ? parse(tmpdir()).root : tmpdir();
		const remoteRoot = realpathSync(mkdtempSync(join(fixtureParent, "vetta-remote-project-")));
		if (process.platform === "win32") windowsFixture = remoteRoot;
		mkdirSync(join(remoteRoot, ".agents/skills/deploy"), { recursive: true });
		writeFileSync(join(remoteRoot, "AGENTS.md"), "REMOTE-PROJECT-RULES\n");
		writeFileSync(
			join(remoteRoot, ".agents/skills/deploy/SKILL.md"),
			"---\nname: deploy\ndescription: Deploy the remote service.\n---\n\nRun the deploy script.\n",
		);
		const agentDir = mkdtempSync(join(tmpdir(), "vetta-agent-dir-"));
		const remotePath = toLoopbackRemotePath(remoteRoot);

		const { resourceSource } = await createDesktopPromptRuntimeSources({
			cwd: formatLoopbackProjectUri("build-01", remoteRoot),
			agentDir,
			sessionOptions: { includeAgentSkills: true },
			runtimeSkillPaths: [],
		} as never);

		const agentsFiles = resourceSource.getAgentsFiles().agentsFiles;
		expect(agentsFiles.map((file) => file.content)).toContain("REMOTE-PROJECT-RULES\n");
		// 这条测试自己就跑在一个带 AGENTS.md 的仓库里：旧实现会把 URI 解析到进程 cwd 之下，
		// 再沿本机祖先目录向上，把本仓库的 AGENTS.md 当成远端项目的规则读进来。
		expect(agentsFiles.every((file) => file.path.startsWith(remotePath) || file.path.startsWith(agentDir))).toBe(
			true,
		);
		const deploy = resourceSource.getSkills().skills.find((skill) => skill.name === "deploy");
		// 模型会把这条路径直接交给跑在远端的 bash：必须是那台机器上的绝对路径，不是 URI。
		expect(deploy?.baseDir).toBe(`${remotePath}/.agents/skills/deploy`);
		expect(deploy?.filePath).toBe(`${remotePath}/.agents/skills/deploy/SKILL.md`);
	}, 30_000);
});
