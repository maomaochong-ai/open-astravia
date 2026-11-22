/**
 * 给 Windows 产物做 Authenticode 签名，并在签名后立刻验证。
 *
 * 关键约束：签名必须是**对 PE 的最后一次写入**。图标与版本资源在 afterPack 里写入，
 * 因此签名挂在同一条链的最后；Inno 安装包在编译完成后再签。任何「签完再改 exe」的顺序
 * 都会让 SmartScreen 看到的仍是未签名状态。
 *
 * 工具选择：
 * - Windows 上优先 `signtool.exe`（Windows SDK / VS 自带）；
 * - 其它平台（或未装 SDK）回落到 `osslsigncode`；
 * - 两者都缺且确实配置了凭据时直接报错，不静默产出「以为签了」的包。
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWindowsSigningConfig } from "./windows-signing-config.mjs";

/** PFX 既可以直接给路径，也可以给 base64（CI 里通常放 secret）。 */
function certificateLooksLikePath(value) {
	return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("./") || value.startsWith("../");
}

export function buildSignToolArgs({ file, certificatePath, certificatePassword, certificateSha1, timestampUrl }) {
	const args = ["sign", "/fd", "sha256", "/td", "sha256", "/tr", timestampUrl];
	if (certificateSha1) args.push("/sha1", certificateSha1);
	if (certificatePath) args.push("/f", certificatePath);
	if (certificatePassword) args.push("/p", certificatePassword);
	args.push(file);
	return args;
}

export function buildOsslSigncodeArgs({ file, certificatePath, certificatePassword, timestampUrl, signedPath }) {
	const args = ["sign", "-pkcs12", certificatePath, "-h", "sha256", "-t", timestampUrl];
	if (certificatePassword) args.push("-pass", certificatePassword);
	args.push("-in", file, "-out", signedPath);
	return args;
}

export function buildVerifyArgs(tool, file) {
	return tool === "signtool" ? ["verify", "/pa", "/all", file] : ["verify", "-in", file];
}

function toolExecutable(tool) {
	return tool === "signtool" ? "signtool.exe" : "osslsigncode";
}

export function defaultResolveSigningTool(run = execFileSync) {
	for (const tool of ["signtool", "osslsigncode"]) {
		try {
			run(toolExecutable(tool), tool === "signtool" ? [] : ["--version"], { stdio: "ignore" });
			return tool;
		} catch {
			// 试下一个；两个都没有时由调用方报错。
		}
	}
	return undefined;
}

/**
 * 签名一组文件。
 *
 * `run` / `resolveTool` 可注入，测试因此不需要真的装证书或 SDK。
 */
export async function signWindowsFiles(
	files,
	{ config = resolveWindowsSigningConfig(), run = execFileSync, resolveTool = defaultResolveSigningTool } = {},
) {
	if (!config.enabled) return { signed: [], skipped: "disabled" };
	if (files.length === 0) return { signed: [] };

	const tool = resolveTool();
	if (!tool) {
		throw new Error(
			"找不到签名工具：Windows 需要 signtool.exe（Windows SDK），其它平台需要 osslsigncode。" +
				"见 docs/deploy/windows-code-signing.md",
		);
	}

	const workDir = await mkdtemp(join(tmpdir(), "astravia-sign-"));
	let certificatePath;
	try {
		if (config.certificateFile) {
			if (certificateLooksLikePath(config.certificateFile) && existsSync(config.certificateFile)) {
				certificatePath = config.certificateFile;
			} else if (certificateLooksLikePath(config.certificateFile)) {
				throw new Error(`[win-sign] 证书文件不存在：${config.certificateFile}`);
			} else {
				certificatePath = join(workDir, "certificate.pfx");
				await writeFile(certificatePath, Buffer.from(config.certificateFile, "base64"), { mode: 0o600 });
			}
		}

		for (const file of files) {
			// osslsigncode 不支持原地覆盖，先写临时文件再替换。
			const signedPath = `${file}.signed`;
			const args =
				tool === "signtool"
					? buildSignToolArgs({
							file,
							certificatePath,
							certificatePassword: config.certificatePassword,
							certificateSha1: config.certificateSha1,
							timestampUrl: config.timestampUrl,
						})
					: buildOsslSigncodeArgs({
							file,
							certificatePath,
							certificatePassword: config.certificatePassword,
							timestampUrl: config.timestampUrl,
							signedPath,
						});
			// 密码通过参数传给子进程；日志里只打文件名与工具，避免把 secret 写进 CI 日志。
			console.log(`[win-sign] signing ${file} with ${tool}`);
			run(toolExecutable(tool), args, { stdio: "inherit" });
			if (tool === "osslsigncode") {
				await rename(signedPath, file);
			}
			// 签名后立即验证：没签成功就直接失败，别让产物带着「以为签了」的名字发出去。
			run(toolExecutable(tool), buildVerifyArgs(tool, file), { stdio: "inherit" });
		}
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}

	return { signed: files, tool };
}

/** 从环境里取签名配置；未配置时返回 undefined。 */
export function windowsSigningFromEnv(env = process.env) {
	const config = resolveWindowsSigningConfig(env);
	return config.enabled ? config : undefined;
}
