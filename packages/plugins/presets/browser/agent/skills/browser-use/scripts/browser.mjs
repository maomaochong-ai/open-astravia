#!/usr/bin/env node
/**
 * 「浏览器操作」插件的 CLI 入口。模型经由 SKILL.md 用 bash 调用本文件，而不是直接调
 * agent-browser——所有策略都由这里加上：
 *
 *   node <SKILL_DIR>/scripts/browser.mjs open example.com
 *
 * 本进程负责四件事，然后把控制权交给原生二进制：
 *   1. 定位 agent-browser 并校验版本（旧版不认识 `--pin-tab` 之类的开关，会以
 *      "Unknown command" 立刻退出，表现为无法排查的静默失败）。
 *   2. 把 renderer 写下的策略快照物化成 agent-browser 原生配置（含 action-policy 绝对路径）。
 *   3. 用 argv 级门禁判定这次调用是否越界。
 *   4. 派生 workspace 级 session 并钉住标签页。
 *
 * 之后直接 spawn 真二进制、stdio 全量继承，本进程不做代理——多一层转发既加延迟，
 * 也会在上游演进时变成需要维护的第二个实现。
 */

import { execFileSync, spawn } from "node:child_process";
import { evaluateBrowserCommand, parseAllowedDomains } from "./lib/guard.mjs";
import { setupGuidance } from "./lib/guidance.mjs";
import { prepareAgentBrowserConfig } from "./lib/prepare.mjs";
import { resolveInstalledAgentBrowser } from "./lib/resolve-binary.mjs";
import { buildSessionId } from "./lib/session.mjs";
import { isAgentBrowserCompatible, parseAgentBrowserVersion } from "./lib/version.mjs";

/** 未就绪：模型需要把引导转述给用户。 */
const EXIT_NOT_READY = 2;
/** 被门禁拦下：模型需要把理由转述给用户。 */
const EXIT_BLOCKED = 3;

function fail(exitCode, message) {
	process.stderr.write(`${message}\n`);
	process.exit(exitCode);
}

function readVersion(binary) {
	try {
		return parseAgentBrowserVersion(
			execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }),
		);
	} catch {
		return null;
	}
}

function main() {
	const argv = process.argv.slice(2);

	const binary = resolveInstalledAgentBrowser();
	if (binary === null) fail(EXIT_NOT_READY, setupGuidance("binary-missing"));

	// 机器上常有用户自己装的旧版全局 agent-browser（nvm / brew）。找得到二进制 ≠ 能用。
	const version = readVersion(binary);
	if (!isAgentBrowserCompatible(version)) fail(EXIT_NOT_READY, setupGuidance("version-too-old", { version }));

	let prepared;
	try {
		prepared = prepareAgentBrowserConfig();
	} catch (error) {
		// 配置写不下去（磁盘满、权限）时不要带着半份配置去跑——那会用上一次的旧策略执行，
		// 用户以为改了设置其实没生效，比明确报未就绪更危险。
		fail(EXIT_NOT_READY, setupGuidance("config-failed", { error: String(error) }));
	}

	const decision = evaluateBrowserCommand(argv, {
		allowedDomains: parseAllowedDomains(prepared.snapshot.allowedDomains),
		denyEval: prepared.snapshot.denyEval,
		denyDownload: prepared.snapshot.denyDownload,
		denyUpload: prepared.snapshot.denyUpload,
	});
	if (decision.action === "block") fail(EXIT_BLOCKED, decision.reason);

	const child = spawn(
		binary,
		[
			"--config",
			prepared.configPath,
			"--session",
			buildSessionId(process.cwd()),
			// 同一个 Chrome 里多个任务并行时，钉住各自的 tab，避免互相抢导航。
			// 配置文件里也写了 pinTab，这里显式再给一次，确保旧配置文件也拿到严格语义。
			"--pin-tab",
			...argv,
		],
		{ stdio: "inherit", windowsHide: true },
	);
	child.on("error", (error) => {
		// 二进制在但起不来（权限、架构不匹配）。
		fail(EXIT_NOT_READY, `${setupGuidance("unknown")}\n底层错误：${error.message}`);
	});
	child.on("exit", (code, signal) => {
		process.exit(signal ? 1 : (code ?? 0));
	});
}

main();
