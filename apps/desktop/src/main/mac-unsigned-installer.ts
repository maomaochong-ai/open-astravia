import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * 未签名 macOS 包的原地升级。
 *
 * Squirrel.Mac 在替换前会用**当前包的指定要求**校验新包签名，而本地开发的 adhoc
 * 包（`codesign -dv` 显示 `linker-signed`、没有 `Authority=Developer ID`）连自己的
 * CodeResources 都不完整，校验必然失败：
 *
 *   code has no resources but signature indicates they must be present
 *
 * 这条链路上没有「重试」可以挽救——拿到 Apple 开发者证书并公证之前，Squirrel 这条路
 * 对这类包是死路。因此这里退到自己解包替换：下载下来的 ZIP 本身是完整的（哈希已由
 * electron-updater 校验），只是没人替我们解压和交换。
 *
 * 顺序上有两个必须遵守的约束：
 *  1. 必须等旧进程真正退出才能替换 `Contents`——正在运行的 Mach-O 被覆盖会得到
 *     `ETXTBSY`，而 macOS 对已映射的可执行文件还会把新包读成半个。
 *  2. 必须去 quarantine。ZIP 是经网络下载的，解开后每个文件都带
 *     `com.apple.quarantine`，首次启动会弹「无法验证开发者」，用户点了取消就回到旧版。
 *
 * 因此真正的动作放在一个脱离本进程的 shell 脚本里：它先等 PID 消失，再解包、替换、
 * 去 quarantine、重新启动。本进程只管把脚本交出去然后退出。
 */

/** 与 updater.ts 的 quit hook 一致：脚本里的重启必须走同一个 bundle 路径。 */
export interface MacUnsignedInstallPlan {
	/** 目标 `.app`，通常是 `/Applications/Astravia.app`。 */
	appPath: string;
	/** 已校验过的更新 ZIP。 */
	archivePath: string;
	/** 当前进程 PID：脚本等它退出后才动文件。 */
	pid: number;
	/** 脚本自己写日志的位置，排障时唯一的事实源。 */
	logPath: string;
}

export interface MacUnsignedInstallScriptOptions {
	/** 覆盖重启命令，测试里换成 `/usr/bin/true`。 */
	relaunch?: string;
	/** 等旧进程退出的上限，超时就放弃（宁可留旧版，也不留半个包）。 */
	waitMs?: number;
}

const DEFAULT_WAIT_MS = 120_000;

/** POSIX 单引号转义：路径里可能有空格、引号、`$`。 */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * 生成安装脚本正文。纯函数，便于断言「等退出 / 解包 / 换包 / 去 quarantine / 重开」
 * 这五步都在，且任何一步失败都不会留下半个包。
 */
export function createMacUnsignedInstallScript(
	plan: MacUnsignedInstallPlan,
	options: MacUnsignedInstallScriptOptions = {},
): string {
	const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
	const relaunch = options.relaunch ?? "open";
	const app = shellQuote(plan.appPath);
	const archive = shellQuote(plan.archivePath);
	const log = shellQuote(plan.logPath);

	return `#!/bin/bash
# Astravia 未签名包原地升级。由应用交棒后运行，日志：
#   ${plan.logPath}
set -u
exec >>${log} 2>&1
echo "[$(date -u +%FT%TZ)] start pid=${plan.pid}"

APP=${app}
ARCHIVE=${archive}
STAGE="$(/usr/bin/mktemp -d "\${TMPDIR:-/tmp}/astravia-update.XXXXXX")" || exit 1
cleanup() { /bin/rm -rf "$STAGE"; }
trap cleanup EXIT

# 交棒后应用已经退出：任何一步失败都会把用户留在桌面全空的状态。为此失败路径一律走
# abort——先记日志，再把应用拉回来，最后以非零码退出。
RELAUNCHED=0
SKIP_RELAUNCH=0
relaunch_app() {
	[ "$SKIP_RELAUNCH" -eq 1 ] && return 0
	[ "$RELAUNCHED" -eq 1 ] && return 0
	if [ ! -d "$APP" ]; then
		echo "[$(date -u +%FT%TZ)] no bundle at $APP, nothing to relaunch"
		return 1
	fi
	if ${relaunch} "$APP"; then
		RELAUNCHED=1
		echo "[$(date -u +%FT%TZ)] relaunched"
		return 0
	fi
	# open 失败（LaunchServices 缓存损坏、新包尚未被索引）时直接执行二进制，
	# 否则用户看到的仍然是「点重启就没了」。
	BIN="$(/usr/bin/find "$APP/Contents/MacOS" -maxdepth 1 -type f -perm -u+x 2>/dev/null | /usr/bin/head -n 1)"
	if [ -n "$BIN" ]; then
		( "$BIN" >/dev/null 2>&1 & )
		RELAUNCHED=1
		echo "[$(date -u +%FT%TZ)] relaunched $BIN directly"
		return 0
	fi
	echo "[$(date -u +%FT%TZ)] relaunch failed: no executable inside $APP"
	return 1
}
abort() {
	echo "[$(date -u +%FT%TZ)] $1"
	relaunch_app || true
	exit 1
}

# 1. 等旧进程真正退出：运行中的可执行文件被覆盖会 ETXTBSY。
deadline=$(( $(/bin/date +%s) + ${Math.ceil(waitMs / 1000)} ))
while /bin/kill -0 ${plan.pid} 2>/dev/null; do
	if [ "$(/bin/date +%s)" -ge "$deadline" ]; then
		echo "[$(date -u +%FT%TZ)] pid ${plan.pid} still alive after ${waitMs}ms, abort"
		# 旧实例还活着：此时再拉起一个会变成双开，用户自己关掉旧窗口即可。
		SKIP_RELAUNCH=1
		exit 1
	fi
	/bin/sleep 0.3
done
echo "[$(date -u +%FT%TZ)] pid ${plan.pid} is gone"

# 2. 解包到暂存目录，确认里面确实有一个 .app。
/usr/bin/ditto -x -k --sequesterRsrc "$ARCHIVE" "$STAGE" || abort "unzip failed"
NEW_APP="$(/usr/bin/find "$STAGE" -maxdepth 2 -name '*.app' -type d | /usr/bin/head -n 1)"
if [ -z "$NEW_APP" ] && [ -f "$STAGE/Contents/Info.plist" ]; then
	# ditto 对 .app 打包时会把 bundle 内容放在归档根，而不是 <名字>.app/ 之下。
	NEW_APP="$STAGE"
fi
[ -n "$NEW_APP" ] && [ -d "$NEW_APP" ] || abort "no .app inside archive"
echo "[$(date -u +%FT%TZ)] staged $NEW_APP"

# 3. 去 quarantine：否则首次启动弹「无法验证开发者」，用户一取消就退回旧版。
/usr/bin/xattr -dr com.apple.quarantine "$NEW_APP" 2>/dev/null || true

# 4. 换包：旧包先改名，替换失败就还原，绝不留半个包。
BACKUP="$APP.old"
/bin/rm -rf "$BACKUP"
/bin/mv "$APP" "$BACKUP" || abort "cannot move aside $APP"
if ! /usr/bin/ditto "$NEW_APP" "$APP"; then
	/bin/rm -rf "$APP"
	/bin/mv "$BACKUP" "$APP"
	abort "copy failed, restored the old bundle"
fi
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
/bin/rm -rf "$BACKUP"
echo "[$(date -u +%FT%TZ)] replaced $APP"

# 5. 重新启动。运行中不允许残留旧实例，所以这里不带 -n。
relaunch_app || abort "relaunch failed"
`;
}

/**
 * 一个 bundle 的签名结论。`reason` 只用于日志：这条链路的失败无法在用户机器上
 * 复现成探针输出，必须把判断依据写进日志。
 */
export interface MacBundleSignature {
	unsigned: boolean;
	reason: string;
}

const CODESIGN_BINARY = "/usr/bin/codesign";
const CODE_RESOURCES_PATH = "Contents/_CodeSignature/CodeResources";
const DEVELOPER_ID_AUTHORITY = "Authority=Developer ID Application";

/**
 * 判断一个 macOS bundle 是否**不能**交给 Squirrel.Mac：未签名、adhoc 或
 * linker-signed 的包在替换前的签名校验必然失败。
 *
 * 主判据是 `Contents/_CodeSignature/CodeResources` 是否存在——Squirrel 报的正是
 * `code has no resources but signature indicates they must be present`，而实机
 * 发布包（`flags=0x20002(adhoc,linker-signed)`）确实没有这个目录。codesign 输出
 * 只作辅助：spawn 失败、没有输出、或拿不到 Developer ID 授权一律按未签名处理，
 * 宁可用内置安装器把自己换成新包，也不要交给一条必然失败的通道。
 */
export function inspectMacBundleSignature(bundlePath: string): MacBundleSignature {
	if (process.platform !== "darwin") return { unsigned: false, reason: "not macOS" };
	if (!existsSync(join(bundlePath, CODE_RESOURCES_PATH))) {
		return { unsigned: true, reason: `no ${CODE_RESOURCES_PATH}` };
	}
	const result = spawnSync(CODESIGN_BINARY, ["-dv", "--verbose=2", bundlePath], { encoding: "utf-8" });
	if (result.error || !result.stdout) {
		const detail = result.error instanceof Error ? result.error.message : "codesign produced no output";
		return { unsigned: true, reason: `codesign unavailable: ${detail}` };
	}
	// codesign 把详情写 stderr；未签名的包直接失败，两个流都要看。
	const output = `${result.stderr ?? ""}\n${result.stdout}`;
	if (output.includes("code object is not signed")) return { unsigned: true, reason: "code object is not signed" };
	if (output.includes("linker-signed")) return { unsigned: true, reason: "linker-signed" };
	if (output.includes("adhoc")) return { unsigned: true, reason: "adhoc signature" };
	if (!output.includes(DEVELOPER_ID_AUTHORITY)) {
		return { unsigned: true, reason: "no Developer ID authority" };
	}
	return { unsigned: false, reason: "Developer ID signed" };
}

export function isUnsignedMacBundle(bundlePath: string): boolean {
	return inspectMacBundleSignature(bundlePath).unsigned;
}

export interface MacUnsignedInstallRequest {
	appPath: string;
	archivePath: string;
	pid?: number;
	cacheRoot: string;
	scriptName: string;
	waitMs?: number;
	/** 仅测试使用：替换重启命令并返回脚本路径而不启动。 */
	dryRun?: boolean;
	relaunch?: string;
}

/**
 * 写出安装脚本并以脱离方式启动，返回脚本路径。调用方随后应自行退出进程。
 */
export async function launchMacUnsignedInstaller(request: MacUnsignedInstallRequest): Promise<string> {
	const logPath = `${request.cacheRoot}/install-${request.scriptName}.log`;
	const scriptPath = `${request.cacheRoot}/install-${request.scriptName}.sh`;
	await mkdir(request.cacheRoot, { recursive: true });
	await rm(logPath, { force: true });
	const script = createMacUnsignedInstallScript(
		{
			appPath: request.appPath,
			archivePath: request.archivePath,
			pid: request.pid ?? process.pid,
			logPath,
		},
		{ waitMs: request.waitMs, relaunch: request.relaunch },
	);
	await writeFile(scriptPath, script, "utf8");
	await chmod(scriptPath, 0o755);
	if (request.dryRun) return scriptPath;

	await new Promise<void>((resolve, reject) => {
		const child = spawn("/bin/bash", [scriptPath], {
			detached: true,
			stdio: "ignore",
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
	return scriptPath;
}

/** 脚本路径旁边放日志，排障时两者一起看。 */
export function installerLogPath(cacheRoot: string, scriptName: string): string {
	return `${dirname(`${cacheRoot}/install-${scriptName}.sh`)}/install-${scriptName}.log`;
}
