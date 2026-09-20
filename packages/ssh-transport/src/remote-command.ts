/**
 * 远端命令串的构造。
 *
 * 所有跨 SSH 执行的东西最终都会被远端的 shell 解释一次，因此本模块是整条链路上唯一
 * 允许拼接命令字符串的地方。路径来自用户选择的目录、模型给出的参数和远端目录列表，
 * 任何一处漏引号都是一次任意命令执行。
 */

/**
 * 包成 POSIX 单引号字面量。
 *
 * 单引号内除了 `'` 本身没有任何元字符，所以只需把每个 `'` 换成 `'\''`（结束引用、
 * 插入转义的引号、重新开始引用）。不要改用双引号：那样 `$`、反引号和 `\` 仍然生效。
 */
export function quoteShellArgument(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export interface RemoteCommandOptions {
	/** 远端工作目录；给出时命令在 `cd` 成功后才执行。 */
	readonly cwd?: string;
	/** 追加到命令之前的环境变量。值同样会被引用。 */
	readonly env?: Readonly<Record<string, string>>;
}

/**
 * 把一条命令包装成可以交给 `ssh` 的单一字符串。
 *
 * 用登录 shell（`$SHELL -l -c`）而不是默认的非交互 shell：nvm、pyenv、asdf 这类工具
 * 只在 `~/.profile` / `~/.zprofile` 里改 PATH，非交互 shell 读不到，结果就是远端明明
 * 装了 node 却报 `command not found`。这是远程 Agent 最常见的一类「假失败」。
 *
 * `cd` 用 `&&` 连接而不是 `;`：目录不存在时必须直接失败，继续在家目录里执行用户的
 * 命令属于「静默换了个仓库」，正是执行边界规则要禁止的。
 */
export function buildRemoteCommand(command: string, options: RemoteCommandOptions = {}): string {
	// 整段脚本会作为 `-c` 的单个参数再被引用一层，因此这里的引号会在最终命令串里
	// 出现二次转义。两层分开构造，才能各自断言。
	// `${SHELL:-/bin/sh}`：远端账号可能没设 SHELL（cron、部分容器镜像），缺省回落到 sh。
	return `exec "\${SHELL:-/bin/sh}" -l -c ${quoteShellArgument(buildRemoteScript(command, options))}`;
}

/** {@link buildRemoteCommand} 交给登录 shell 的那段脚本，未经外层引用。 */
export function buildRemoteScript(command: string, options: RemoteCommandOptions = {}): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(options.env ?? {})) {
		assertEnvName(key);
		parts.push(`export ${key}=${quoteShellArgument(value)}`);
	}
	if (options.cwd !== undefined) {
		parts.push(`cd ${quoteShellArgument(options.cwd)}`);
	}
	parts.push(command);
	return parts.join(" && ");
}

/** 远端系统家族。决定 `stat` 用哪套格式串——GNU 与 BSD 互不兼容。 */
export type RemoteStatFlavor = "gnu" | "bsd";

/**
 * `stat` 的类型字段会被远端 locale 翻译：中文系统上 `%F` 给的是「目录」而不是
 * `directory`，按英文解析就会把每个条目都判成未知类型，目录列表随即变成空的。
 *
 * 用 `env` 而不是 `LC_ALL=C cmd` 这种前缀赋值：后者是 POSIX shell 语法，fish 之类
 * 的登录 shell 不认；`env` 在任何 shell 里都只是一个普通命令。
 */
const FORCE_C_LOCALE = "env LC_ALL=C LANG=C";

/** stat 的格式串。名字放最后一个字段，因为文件名可以包含制表符。 */
function statFormat(flavor: RemoteStatFlavor): string {
	return flavor === "gnu" ? `--printf='%F\\t%s\\t%Y\\t%n\\n'` : `-f '%HT\\t%z\\t%m\\t%N'`;
}

/** 单个路径的 stat，与目录列举同格式，便于共用一套解析。 */
export function buildStatCommand(remotePath: string, flavor: RemoteStatFlavor): string {
	const quoted = quoteShellArgument(remotePath);
	// `[ -e ]` 先判存在：不存在时直接退 0 并输出空，避免把 stat 的报错当成传输故障。
	return `[ -e ${quoted} ] && ${FORCE_C_LOCALE} stat ${statFormat(flavor)} ${quoted} || true`;
}

/**
 * 目录列举：一次往返拿回每个条目的类型、大小和修改时间。
 *
 * 逐个文件 stat 在几百个条目的目录上就是几百次往返，展开一个 node_modules 能卡住
 * 整个文件树，所以这里一次 `find -exec ... +` 批量取回。
 *
 * 不用 `ls`：它的输出格式随 locale 和实现变化，且无法可靠还原带空格的文件名。
 * flavor 由调用方按探测到的远端平台传入，不在远端用 `||` 试错——试错会在第一条
 * 命令部分成功时给出半截输出。
 */
export function buildListDirectoryCommand(remotePath: string, flavor: RemoteStatFlavor): string {
	return [
		`cd ${quoteShellArgument(remotePath)}`,
		`find . -maxdepth 1 -mindepth 1 -exec ${FORCE_C_LOCALE} stat ${statFormat(flavor)} {} +`,
	].join(" && ");
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertEnvName(name: string): void {
	if (!ENV_NAME_PATTERN.test(name)) {
		throw new Error(`Invalid environment variable name: ${name}`);
	}
}
