import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import { getAppLogger } from "../logger.js";
import {
	binDirsFor,
	executablePathFor,
	installDir,
	npmCacheDir,
	npmGlobalBinDir,
	npmGlobalPrefixDir,
	type PlatformEntry,
	pipCacheDir,
	platformEntry,
	RUNTIME_MANIFEST,
	type RuntimeType,
	registryPath,
	runtimesDir,
	runtimeVersion,
	vendorRuntimeArchivePath,
} from "./paths.js";
import { installRuntimeArchive } from "./runtime-archive-installer.js";
import type { RuntimeRegistryData, RuntimeStatus, RuntimesStatus } from "./types.js";

const log = getAppLogger("runtimes");

// 在任何 PATH 注入之前抓一份系统 PATH 快照，用于探测「真正的系统运行时」——
// 否则 applyEnv() 之后再探测会把我们自己注入的托管版当成系统版。
const SYSTEM_PATH_SNAPSHOT = process.env.PATH ?? process.env.Path ?? "";

const RUNTIME_TYPES: RuntimeType[] = ["node", "python"];

function emptyRegistry(): RuntimeRegistryData {
	return { version: 1, binaries: {}, systemDetection: {} };
}

/** 解析版本号:node `v22.20.0`→`22.20.0`;python `Python 3.13.9`→`3.13.9`。 */
function parseVersion(raw: string): string | undefined {
	const m = raw.match(/(\d+\.\d+\.\d+)/);
	return m?.[1];
}

export class RuntimeManager {
	private data: RuntimeRegistryData = emptyRegistry();

	private loadRegistry(): void {
		try {
			if (existsSync(registryPath())) {
				const parsed = JSON.parse(readFileSync(registryPath(), "utf-8")) as RuntimeRegistryData;
				if (parsed && parsed.version === 1) {
					this.data = {
						version: 1,
						binaries: parsed.binaries ?? {},
						systemDetection: parsed.systemDetection ?? {},
					};
				}
			}
		} catch (err) {
			log.warn("registry load failed, starting fresh", err);
			this.data = emptyRegistry();
		}
	}

	private saveRegistry(): void {
		try {
			atomicWriteJSON(registryPath(), this.data);
		} catch (err) {
			log.warn("registry save failed", err);
		}
	}

	/** 探测系统已安装的同名运行时(用系统 PATH 快照,不含我们的注入)。 */
	private detectSystem(type: RuntimeType): void {
		const candidates = type === "python" ? ["python3", "python"] : ["node"];
		const env = { ...process.env, PATH: SYSTEM_PATH_SNAPSHOT, Path: SYSTEM_PATH_SNAPSHOT };
		for (const cmd of candidates) {
			try {
				const res = spawnSync(cmd, ["--version"], { encoding: "utf-8", timeout: 5000, env });
				if (res.status === 0) {
					const version = parseVersion(`${res.stdout}${res.stderr}`);
					const whichRes = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
						encoding: "utf-8",
						timeout: 5000,
						env,
					});
					const path = whichRes.stdout?.trim().split(/\r?\n/)[0];
					if (version && path && existsSync(path)) {
						this.data.systemDetection[type] = { path, version, detectedAt: Date.now() };
						return;
					}
				}
			} catch {
				// 继续尝试下一个候选名
			}
		}
		delete this.data.systemDetection[type];
	}

	/** 内置 vendor 归档 → ~/.vetta/runtimes 首启解压。返回是否完成 seed。 */
	private async seedFromVendor(type: RuntimeType): Promise<boolean> {
		const entry = platformEntry(type);
		if (!entry) return false;
		const version = runtimeVersion(type);
		const target = installDir(type, version);
		const marker = join(target, ".vendor-version");
		if (existsSync(executablePathFor(type, version)) && this.readMarker(marker) === version) {
			return true; // 已 seed 且版本一致,跳过解压
		}
		const source = vendorRuntimeArchivePath(type);
		if (!existsSync(source)) return false;

		log.info(`seeding ${type} ${version} from vendor`, { source, target });
		await this.installArchive(type, source, entry, version);
		return true;
	}

	private async installArchive(
		type: RuntimeType,
		archivePath: string,
		entry: PlatformEntry,
		version: string,
	): Promise<void> {
		const target = installDir(type, version);
		await installRuntimeArchive({
			archivePath,
			archiveType: entry.archive,
			innerDirectory: entry.dir,
			targetDirectory: target,
		});
		await this.makeExecutable(type, version);
		writeFileSync(join(target, ".vendor-version"), version);
	}

	private readMarker(path: string): string | undefined {
		try {
			return existsSync(path) ? readFileSync(path, "utf-8").trim() : undefined;
		} catch {
			return undefined;
		}
	}

	private async makeExecutable(type: RuntimeType, version: string): Promise<void> {
		if (process.platform === "win32") return;
		const exe = executablePathFor(type, version);
		try {
			if (existsSync(exe)) await chmod(exe, 0o755);
		} catch {
			// best-effort
		}
	}

	/**
	 * 下载兜底(升级 / 无内置 vendor 时)。从 sources 列表逐个尝试,解压到安装目录。
	 * 这是次要路径——首启主路径是 seedFromVendor。无网络时会失败,由调用方容错。
	 */
	private async download(type: RuntimeType): Promise<boolean> {
		const entry = platformEntry(type);
		if (!entry) return false;
		const def = RUNTIME_MANIFEST[type];
		const version = def.version;
		const release = type === "python" ? RUNTIME_MANIFEST.python.release : "";
		const urls = def.sources.map((tpl) =>
			tpl.replace("{version}", version).replace("{release}", release).replace("{filename}", entry.filename),
		);

		const tmpFile = join(runtimesDir(), ".cache", `${type}-${version}-${entry.filename}`);
		mkdirSync(join(runtimesDir(), ".cache"), { recursive: true });
		for (const url of urls) {
			try {
				log.info(`downloading ${type} from ${url}`);
				await this.fetchToFile(url, tmpFile);
				await this.installArchive(type, tmpFile, entry, version);
				rmSync(tmpFile, { force: true });
				return true;
			} catch (err) {
				log.warn(`download from ${url} failed`, err);
			}
		}
		return false;
	}

	private async fetchToFile(url: string, dest: string): Promise<void> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 180_000);
		try {
			const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
		} finally {
			clearTimeout(timer);
		}
	}

	private isReady(type: RuntimeType): boolean {
		return existsSync(executablePathFor(type));
	}

	private npmConfigPath(): string {
		return join(runtimesDir(), ".npmrc");
	}

	private writeNpmConfig(): void {
		if (!this.isReady("node")) return;
		mkdirSync(runtimesDir(), { recursive: true });
		mkdirSync(npmGlobalPrefixDir(), { recursive: true });
		mkdirSync(npmCacheDir(), { recursive: true });
		writeFileSync(
			this.npmConfigPath(),
			[
				`registry=${RUNTIME_MANIFEST.mirrors.npmRegistry}`,
				`prefix=${npmGlobalPrefixDir()}`,
				`cache=${npmCacheDir()}`,
				"",
			].join("\n"),
		);
	}

	private async writeNpmShimScripts(): Promise<void> {
		if (!this.isReady("node")) return;
		const npmCli = join(installDir("node"), "node_modules", "npm", "bin", "npm-cli.js");
		const npxCli = join(installDir("node"), "node_modules", "npm", "bin", "npx-cli.js");
		if (!existsSync(npmCli) || !existsSync(npxCli)) return;

		const shimDir = npmGlobalBinDir();
		mkdirSync(shimDir, { recursive: true });
		if (process.platform === "win32") {
			const npmScript = [
				"@echo off",
				`if not defined npm_config_userconfig set "npm_config_userconfig=${this.npmConfigPath()}"`,
				`if not defined NPM_CONFIG_USERCONFIG set "NPM_CONFIG_USERCONFIG=${this.npmConfigPath()}"`,
				`"${executablePathFor("node")}" "${npmCli}" %*`,
				"",
			].join("\r\n");
			const npxScript = [
				"@echo off",
				`if not defined npm_config_userconfig set "npm_config_userconfig=${this.npmConfigPath()}"`,
				`if not defined NPM_CONFIG_USERCONFIG set "NPM_CONFIG_USERCONFIG=${this.npmConfigPath()}"`,
				`"${executablePathFor("node")}" "${npxCli}" %*`,
				"",
			].join("\r\n");
			writeFileSync(join(shimDir, "npm.cmd"), npmScript);
			writeFileSync(join(shimDir, "npx.cmd"), npxScript);
			return;
		}

		const npmScript = [
			"#!/usr/bin/env sh",
			`: "${`npm_config_userconfig:=${this.npmConfigPath()}`}"`,
			`: "${`NPM_CONFIG_USERCONFIG:=${this.npmConfigPath()}`}"`,
			"export npm_config_userconfig NPM_CONFIG_USERCONFIG",
			`exec "${executablePathFor("node")}" "${npmCli}" "$@"`,
			"",
		].join("\n");
		const npxScript = [
			"#!/usr/bin/env sh",
			`: "${`npm_config_userconfig:=${this.npmConfigPath()}`}"`,
			`: "${`NPM_CONFIG_USERCONFIG:=${this.npmConfigPath()}`}"`,
			"export npm_config_userconfig NPM_CONFIG_USERCONFIG",
			`exec "${executablePathFor("node")}" "${npxCli}" "$@"`,
			"",
		].join("\n");
		const npmPath = join(shimDir, "npm");
		const npxPath = join(shimDir, "npx");
		writeFileSync(npmPath, npmScript);
		writeFileSync(npxPath, npxScript);
		await chmod(npmPath, 0o755);
		await chmod(npxPath, 0o755);
	}

	private async ensureNpm(type: RuntimeType): Promise<void> {
		if (process.platform !== "win32") return;
		if (type !== "node" || !this.isReady(type)) return;
		this.writeNpmConfig();
		await this.writeNpmShimScripts();
	}

	private pipScriptsDir(): string {
		const root = installDir("python");
		return process.platform === "win32" ? join(root, "Scripts") : join(root, "bin");
	}

	private pythonSitePackagesDir(): string {
		return join(installDir("python"), "Lib", "site-packages");
	}

	private pipConfigPath(): string {
		return join(installDir("python"), "pip.ini");
	}

	private pythonSiteCustomizePath(): string {
		return join(this.pythonSitePackagesDir(), "sitecustomize.py");
	}

	private writePythonSiteCustomize(): void {
		if (process.platform !== "win32" || !this.isReady("python")) return;
		const siteCustomizePath = this.pythonSiteCustomizePath();
		mkdirSync(this.pythonSitePackagesDir(), { recursive: true });
		writeFileSync(
			siteCustomizePath,
			[
				"import errno",
				"import os",
				"import sys",
				"import tempfile",
				"",
				"if os.name == 'nt' and os.environ.get('VETTA_WINDOWS_SANDBOX') == '1':",
				"    def _vetta_mkdtemp(suffix=None, prefix=None, dir=None):",
				"        prefix, suffix, dir, output_type = tempfile._sanitize_params(prefix, suffix, dir)",
				"        names = tempfile._get_candidate_names()",
				"        if output_type is bytes:",
				"            names = map(os.fsencode, names)",
				"        for _ in range(tempfile.TMP_MAX):",
				"            name = next(names)",
				"            file = os.path.join(dir, prefix + name + suffix)",
				"            sys.audit('tempfile.mkdtemp', file)",
				"            try:",
				"                os.mkdir(file, 0o777)",
				"            except FileExistsError:",
				"                continue",
				"            except PermissionError:",
				"                if os.path.isdir(dir) and os.access(dir, os.W_OK):",
				"                    continue",
				"                raise",
				"            return os.path.abspath(file)",
				"        raise FileExistsError(errno.EEXIST, 'No usable temporary directory name found')",
				"",
				"    tempfile.mkdtemp = _vetta_mkdtemp",
				"",
			].join("\n"),
		);
	}

	private writePipConfig(): void {
		if (!this.isReady("python")) return;
		mkdirSync(pipCacheDir(), { recursive: true });
		this.writePythonSiteCustomize();
		writeFileSync(
			this.pipConfigPath(),
			[
				"[global]",
				`index-url = ${RUNTIME_MANIFEST.mirrors.pipIndexUrl}`,
				`trusted-host = ${RUNTIME_MANIFEST.mirrors.pipTrustedHost}`,
				`cache-dir = ${pipCacheDir()}`,
				"",
			].join("\n"),
		);
	}

	private pipEntryCandidates(): string[] {
		const scriptsDir = this.pipScriptsDir();
		if (process.platform === "win32") {
			return [
				join(scriptsDir, "pip.exe"),
				join(scriptsDir, "pip3.exe"),
				join(scriptsDir, "pip.cmd"),
				join(scriptsDir, "pip3.cmd"),
			];
		}
		return [join(scriptsDir, "pip"), join(scriptsDir, "pip3")];
	}

	private hasPipEntry(): boolean {
		return this.pipEntryCandidates().some((path) => existsSync(path));
	}

	private runPython(args: string[], timeout: number, env?: NodeJS.ProcessEnv): boolean {
		const res = spawnSync(executablePathFor("python"), args, {
			encoding: "utf-8",
			timeout,
			env,
		});
		if (res.status === 0) return true;
		log.warn("python command failed", {
			args,
			status: res.status,
			stderr: res.stderr,
			stdout: res.stdout,
			error: res.error?.message,
		});
		return false;
	}

	private getEnsurepipBundledDir(): string | undefined {
		const res = spawnSync(
			executablePathFor("python"),
			["-c", "import ensurepip, pathlib; print(pathlib.Path(ensurepip.__file__).with_name('_bundled'))"],
			{ encoding: "utf-8", timeout: 10_000 },
		);
		const bundledDir = res.status === 0 ? res.stdout.trim() : "";
		return bundledDir && existsSync(bundledDir) ? bundledDir : undefined;
	}

	private async writePipShimScripts(): Promise<void> {
		if (!this.runPython(["-m", "pip", "--version"], 10_000)) return;

		const scriptsDir = this.pipScriptsDir();
		mkdirSync(scriptsDir, { recursive: true });
		if (process.platform === "win32") {
			const script = [
				"@echo off",
				`if not defined PIP_CONFIG_FILE set "PIP_CONFIG_FILE=${this.pipConfigPath()}"`,
				`if not defined PIP_INDEX_URL set "PIP_INDEX_URL=${RUNTIME_MANIFEST.mirrors.pipIndexUrl}"`,
				`if not defined PIP_TRUSTED_HOST set "PIP_TRUSTED_HOST=${RUNTIME_MANIFEST.mirrors.pipTrustedHost}"`,
				`if not defined PIP_CACHE_DIR set "PIP_CACHE_DIR=${pipCacheDir()}"`,
				`"${executablePathFor("python")}" -m pip %*`,
				"",
			].join("\r\n");
			writeFileSync(join(scriptsDir, "pip.cmd"), script);
			writeFileSync(join(scriptsDir, "pip3.cmd"), script);
			return;
		}

		const script = [
			"#!/usr/bin/env sh",
			`: "${`PIP_CONFIG_FILE:=${this.pipConfigPath()}`}"`,
			`: "${`PIP_INDEX_URL:=${RUNTIME_MANIFEST.mirrors.pipIndexUrl}`}"`,
			`: "${`PIP_TRUSTED_HOST:=${RUNTIME_MANIFEST.mirrors.pipTrustedHost}`}"`,
			`: "${`PIP_CACHE_DIR:=${pipCacheDir()}`}"`,
			"export PIP_CONFIG_FILE PIP_INDEX_URL PIP_TRUSTED_HOST PIP_CACHE_DIR",
			`exec "${executablePathFor("python")}" -m pip "$@"`,
			"",
		].join("\n");
		const pipPath = join(scriptsDir, "pip");
		const pip3Path = join(scriptsDir, "pip3");
		writeFileSync(pipPath, script);
		writeFileSync(pip3Path, script);
		await chmod(pipPath, 0o755);
		await chmod(pip3Path, 0o755);
	}

	/**
	 * python-build-standalone 自带 pip 包但可能缺少 CLI 入口(pip.exe/pip3.exe),
	 * 导致 bash 中 `pip` 落到系统的 pyenv shim 报错。优先生成轻量 wrapper,
	 * 再用本地 bundled wheel 修复官方入口,仅本地修复失败时走镜像网络兜底。
	 */
	private async ensurePip(type: RuntimeType): Promise<void> {
		if (process.platform !== "win32") return;
		if (type !== "python" || !this.isReady(type)) return;
		this.writePipConfig();
		if (this.hasPipEntry()) {
			await this.writePipShimScripts();
			return;
		}

		log.info("generating pip CLI entry points");
		try {
			mkdirSync(this.pipScriptsDir(), { recursive: true });

			this.runPython(["-m", "ensurepip", "--upgrade", "--default-pip"], 30_000);
			if (this.hasPipEntry()) return;

			await this.writePipShimScripts();
			if (this.hasPipEntry()) return;

			const bundledDir = this.getEnsurepipBundledDir();
			if (bundledDir) {
				this.runPython(
					[
						"-m",
						"pip",
						"install",
						"--force-reinstall",
						"--no-index",
						"--find-links",
						bundledDir,
						"--no-warn-script-location",
						"pip",
					],
					60_000,
				);
				if (this.hasPipEntry()) return;
				await this.writePipShimScripts();
				if (this.hasPipEntry()) return;
			}

			this.runPython(
				["-m", "pip", "install", "--force-reinstall", "--no-deps", "--no-warn-script-location", "pip"],
				60_000,
				{
					...process.env,
					PIP_INDEX_URL: RUNTIME_MANIFEST.mirrors.pipIndexUrl,
					PIP_TRUSTED_HOST: RUNTIME_MANIFEST.mirrors.pipTrustedHost,
					PIP_CACHE_DIR: pipCacheDir(),
				},
			);
			await this.writePipShimScripts();
			if (!this.hasPipEntry()) log.warn("pip entry point generation did not create a pip executable");
		} catch (err) {
			log.warn("ensure pip scripts failed", err);
		}
	}

	private recordManaged(type: RuntimeType): void {
		const version = runtimeVersion(type);
		this.data.binaries[type] = {
			source: "managed",
			version,
			executablePath: executablePathFor(type, version),
			installPath: installDir(type, version),
			installedAt: Date.now(),
			verified: true,
		};
	}

	/** 探测系统 + 首启 seed(失败回退下载)。不抛错:任一运行时失败不阻断启动。 */
	async initialize(): Promise<void> {
		this.loadRegistry();
		for (const type of RUNTIME_TYPES) {
			try {
				this.detectSystem(type);
			} catch (err) {
				log.warn(`detect system ${type} failed`, err);
			}
			try {
				// 启动只走零网络的 vendor 归档解压;下载是面板触发的次要路径(见 reinstall),
				// 不在启动阻塞,避免无内置 vendor 的开发态/异常环境卡在 180s 超时。
				if (!this.isReady(type)) {
					await this.seedFromVendor(type);
				}
				if (this.isReady(type)) {
					this.recordManaged(type);
					await this.ensureNpm(type);
					await this.ensurePip(type);
				} else {
					delete this.data.binaries[type];
					log.warn(`${type} not ready (vendor absent); deferring to panel-driven download`);
				}
			} catch (err) {
				log.error(`ensure ${type} failed`, err);
			}
		}
		this.saveRegistry();
	}

	/**
	 * 把托管运行时注入全局 process.env(ADR-0011 / A1)。一处生效:桌面 in-process
	 * bash 经 getShellEnv() spread、IM sidecar 继承 main env → coding-agent → bash。
	 * 幂等:重复调用安全。即使运行时未就绪也安全(前置不存在目录无害)。
	 */
	applyEnv(): void {
		const dirs: string[] = process.platform === "win32" ? [npmGlobalBinDir()] : [];
		for (const type of RUNTIME_TYPES) {
			if (this.isReady(type)) dirs.push(...binDirsFor(type));
		}
		if (process.platform !== "win32") dirs.push(npmGlobalBinDir());

		const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
		const existing = (process.env[pathKey] ?? "").split(delimiter).filter(Boolean);
		const merged = [...dirs.filter((d) => !existing.includes(d)), ...existing];
		process.env[pathKey] = merged.join(delimiter);

		if (process.platform === "win32" && this.isReady("node")) {
			try {
				this.writeNpmConfig();
				void this.writeNpmShimScripts().catch((err) => log.warn("npm shim generation failed", err));
				process.env.npm_config_userconfig = this.npmConfigPath();
				process.env.NPM_CONFIG_USERCONFIG = this.npmConfigPath();
			} catch (err) {
				log.warn("npm config generation failed", err);
			}
		}
		process.env.npm_config_registry = RUNTIME_MANIFEST.mirrors.npmRegistry;
		process.env.npm_config_prefix = npmGlobalPrefixDir();
		process.env.npm_config_cache = npmCacheDir();
		if (process.platform === "win32" && this.isReady("python")) {
			this.writePipConfig();
			process.env.PIP_CONFIG_FILE = this.pipConfigPath();
			process.env.VETTA_MANAGED_PYTHON_SITE_PACKAGES = this.pythonSitePackagesDir();
			process.env.VETTA_MANAGED_PYTHON_SCRIPTS = this.pipScriptsDir();
		}
		process.env.PIP_INDEX_URL = RUNTIME_MANIFEST.mirrors.pipIndexUrl;
		process.env.PIP_TRUSTED_HOST = RUNTIME_MANIFEST.mirrors.pipTrustedHost;
		process.env.PIP_CACHE_DIR = pipCacheDir();

		// 确保 npm 全局前缀目录存在,否则首个 `npm i -g` 会因 prefix 不存在报错。
		try {
			mkdirSync(npmGlobalBinDir(), { recursive: true });
			mkdirSync(npmCacheDir(), { recursive: true });
			mkdirSync(pipCacheDir(), { recursive: true });
		} catch {
			// best-effort
		}

		log.info("runtime env applied", {
			node: this.isReady("node"),
			python: this.isReady("python"),
			npmRegistry: RUNTIME_MANIFEST.mirrors.npmRegistry,
		});
	}

	private statusFor(type: RuntimeType): RuntimeStatus {
		const entry = platformEntry(type);
		const ready = this.isReady(type);
		const system = this.data.systemDetection[type];
		return {
			type,
			ready,
			recommendedVersion: runtimeVersion(type),
			managedVersion: ready ? runtimeVersion(type) : undefined,
			executablePath: ready ? executablePathFor(type) : undefined,
			activeSource: "managed",
			system: system ? { path: system.path, version: system.version } : undefined,
			supported: Boolean(entry),
		};
	}

	getStatus(): RuntimesStatus {
		return {
			node: this.statusFor("node"),
			python: this.statusFor("python"),
			mirrors: {
				npmRegistry: RUNTIME_MANIFEST.mirrors.npmRegistry,
				pipIndexUrl: RUNTIME_MANIFEST.mirrors.pipIndexUrl,
			},
		};
	}

	/** 面板「升级/重新获取」:强制重新 seed/下载推荐版本,再刷新 env。 */
	async reinstall(type: RuntimeType): Promise<RuntimeStatus> {
		const target = installDir(type);
		rmSync(join(target, ".vendor-version"), { force: true });
		const seeded = await this.seedFromVendor(type);
		if (!seeded) await this.download(type);
		if (this.isReady(type)) {
			this.recordManaged(type);
			await this.ensureNpm(type);
			await this.ensurePip(type);
		}
		this.saveRegistry();
		this.applyEnv();
		return this.statusFor(type);
	}

	/** 面板「重新探测系统运行时」。 */
	redetect(): RuntimesStatus {
		for (const type of RUNTIME_TYPES) this.detectSystem(type);
		this.saveRegistry();
		return this.getStatus();
	}
}

let shared: RuntimeManager | null = null;

export function getRuntimeManager(): RuntimeManager {
	if (!shared) shared = new RuntimeManager();
	return shared;
}
