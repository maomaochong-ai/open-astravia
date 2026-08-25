#!/usr/bin/env node
/**
 * 「浏览器操作」插件的 MCP 入口。
 *
 * 宿主按清单 `agent.mcpServers` 为**每个 Agent 会话**各起一个本进程（插件 MCP 是
 * session-local 的），所以「每对话一个钉住的 tab」在这里天然成立：本进程生成一个
 * session id，透传给 agent-browser。
 *
 * 就绪时：直接 exec 真的 `agent-browser ... mcp`，stdio 全量继承，本进程只做参数拼装，
 * 不当代理——多一层转发既加延迟，也会在协议演进时变成需要维护的第二个实现。
 * 不就绪时（没装 / 版本太旧 / 配置写不下去）：退回 stub server，见 lib/stub-server.mjs。
 */

import { execFileSync, spawn } from "node:child_process";
import { buildMcpArgv, buildSessionId } from "./lib/argv.mjs";
import { prepareAgentBrowserConfig } from "./lib/prepare.mjs";
import { resolveInstalledAgentBrowser } from "./lib/resolve-binary.mjs";
import { runStubServer } from "./lib/stub-server.mjs";
import { isAgentBrowserCompatible, parseAgentBrowserVersion } from "./lib/version.mjs";

/**
 * 读版本。用同步执行是刻意的：整个启动路径必须在碰 stdin 之前把「能不能用」定下来，
 * 一旦开始转发就没法再退回 stub 了。原生二进制的 --version 是毫秒级。
 */
function readVersion(binary) {
	try {
		return parseAgentBrowserVersion(
			execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }),
		);
	} catch {
		return null;
	}
}

function start() {
	const binary = resolveInstalledAgentBrowser();
	if (binary === null) return runStubServer("binary-missing");

	// 机器上常有用户自己装的旧版全局 agent-browser。旧版不认识 `--pin-tab` 之类的开关，
	// 会立刻以 "Unknown command" 退出——不校验的话表现为工具面整个消失且没有任何提示。
	const version = readVersion(binary);
	if (!isAgentBrowserCompatible(version)) return runStubServer("version-too-old", { version });

	let prepared;
	try {
		prepared = prepareAgentBrowserConfig();
	} catch (error) {
		// 配置写不下去（磁盘满、权限）时不要带着半份配置去启动真 server——那会用上一次的
		// 旧策略跑，用户以为改了设置其实没生效，比明确报未就绪更危险。
		process.stderr.write(`[vetta-browser] failed to materialize config: ${String(error)}\n`);
		return runStubServer("config-failed");
	}

	const argv = buildMcpArgv({
		configPath: prepared.configPath,
		sessionId: buildSessionId(),
		toolsProfile: prepared.toolsProfile,
	});
	const child = spawn(binary, argv, { stdio: "inherit", windowsHide: true });
	child.on("error", (error) => {
		// 二进制在但起不来（权限、架构不匹配）——此时还没读过 stdin，退回 stub 仍然安全。
		process.stderr.write(`[vetta-browser] failed to start agent-browser: ${error.message}\n`);
		runStubServer("spawn-failed");
	});
	child.on("exit", (code, signal) => {
		process.exit(signal ? 1 : (code ?? 0));
	});
	const forward = (signal) => () => child.kill(signal);
	process.on("SIGTERM", forward("SIGTERM"));
	process.on("SIGINT", forward("SIGINT"));
}

start();
