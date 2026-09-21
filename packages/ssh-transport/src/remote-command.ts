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
	/**
	 * 给出时，命令启动前把自己的进程组号记到远端临时目录下的这个文件名里，供
	 * {@link buildKillCommand} 事后终止。只能是文件名，不是路径。
	 */
	readonly processToken?: string;
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
 *
 * 最外层固定交给 `/bin/sh`：sshd 用账号的登录 shell 解释这条命令串，而 fish 之类
 * 不认 `${VAR:-default}`。外层只用「命令 + 单引号参数」这一种所有 shell 都认的写法。
 */
export function buildRemoteCommand(command: string, options: RemoteCommandOptions = {}): string {
	// 整段脚本会作为位置参数再被引用一层，因此这里的引号会在最终命令串里出现二次转义。
	// 两层分开构造，才能各自断言。
	const script = quoteShellArgument(buildRemoteScript(command, options));
	// `${SHELL:-/bin/sh}`：远端账号可能没设 SHELL（cron、部分容器镜像），缺省回落到 sh。
	if (options.processToken === undefined) {
		return `/bin/sh -c 'exec "\${SHELL:-/bin/sh}" -l -c "$1"' vetta ${script}`;
	}
	assertProcessToken(options.processToken);
	const launcher = [
		`f="\${TMPDIR:-/tmp}/${options.processToken}"`,
		// 记进程组而不是 pid：用户命令会派生子进程（npm → node → esbuild），只杀领头的
		// 那个会把其余的留成孤儿。sshd 为无 pty 的会话调用过 setsid()，所以这个组里只有
		// 本条命令的进程。
		//
		// 但「整组杀掉」只在这个组**确实属于本条命令**时才安全：组长必须是自己或自己的父进程
		// （sshd 起的那个登录 shell）。否则——某些 sshd 替代品、或者任何没有 setsid 的环境——
		// 这个组里还有别人的进程，整组杀掉会连带杀死同一条连接上的其它命令。那种情况下只记
		// 自己的 pid（前缀 p），终止时退化为杀单个进程及其直接子进程。
		`g=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')`,
		`if [ -n "$g" ] && { [ "$g" = "$$" ] || [ "$g" = "$PPID" ]; }; then printf 'g%s' "$g" > "$f"; else printf 'p%s' "$$" > "$f"; fi`,
		`"\${SHELL:-/bin/sh}" -l -c "$1"`,
		"s=$?",
		`rm -f -- "$f"`,
		"exit $s",
	].join("\n");
	return `/bin/sh -c ${quoteShellArgument(launcher)} vetta ${script}`;
}

/**
 * 终止一条带 `processToken` 启动的命令及其派生的全部进程。
 *
 * 必须有这一步：`ssh -T` 不分配 pty，本地中止 ssh 只是关掉通道，远端进程**不会**收到
 * SIGHUP——没有控制终端就没有挂断信号。它要么活到下一次往已关闭的 stdout 写入时被
 * SIGPIPE 杀掉，要么（不产生输出的进程）永远留在远端。
 *
 * 先 TERM 再 KILL：给 dev server 一次清理端口和临时文件的机会。
 */
export function buildKillCommand(processToken: string): string {
	assertProcessToken(processToken);
	const script = [
		`f="\${TMPDIR:-/tmp}/${processToken}"`,
		`r=$(cat "$f" 2>/dev/null) || exit 0`,
		`rm -f -- "$f"`,
		`k=\${r%"\${r#?}"}`,
		`n=\${r#?}`,
		// 只接受大于 1 的纯数字：`kill -- -1` 会杀掉该用户的所有进程。
		`case "$n" in ''|*[!0-9]*|0|1) exit 0 ;; esac`,
		`if [ "$k" = g ]; then t="-$n"; else t="$n"; pkill -TERM -P "$n" 2>/dev/null; fi`,
		`kill -TERM -- "$t" 2>/dev/null || exit 0`,
		"i=0",
		`while [ $i -lt 20 ] && kill -0 -- "$t" 2>/dev/null; do sleep 0.1; i=$((i+1)); done`,
		`if [ "$k" != g ]; then pkill -KILL -P "$n" 2>/dev/null; fi`,
		`kill -KILL -- "$t" 2>/dev/null`,
		"exit 0",
	].join("\n");
	return `/bin/sh -c ${quoteShellArgument(script)}`;
}

const PROCESS_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;

function assertProcessToken(token: string): void {
	if (!PROCESS_TOKEN_PATTERN.test(token)) {
		throw new Error(`Invalid remote process token: ${token}`);
	}
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

/**
 * stat 的格式串。名字放最后一个字段，因为文件名可以包含制表符。
 *
 * 两处都嵌入**真正的制表符**，不写反斜杠 t：只有 GNU 的 `--printf` 会解释反斜杠转义，
 * BSD 的 `-f` 与 busybox 的 `-c` 都原样输出反斜杠加 t，整行随即解析不出任何字段。
 *
 * GNU 侧用 `-c` 而不是 `--printf`：busybox 的 stat 只认 `-c`，`--printf` 会直接报
 * unrecognized option——远端是 Alpine 这类精简系统时，文件树全空、读写全报文件不存在。
 * 两者的差别只有「不解释转义」和「每条记录后自带换行」，在这里都正合适。已在 GNU
 * coreutils 9.1 与 busybox 1.37 上核对过两种写法的输出逐字节一致。
 */
function statFormat(flavor: RemoteStatFlavor): string {
	return flavor === "gnu" ? `-c '%F	%s	%Y	%n'` : `-f '%HT	%z	%m	%N'`;
}

/**
 * 单个路径的 stat，与目录列举同格式，便于共用一套解析。
 *
 * `followSymlinks` 对应 `stat -L`（GNU 与 BSD 同名）：问的是「链接指向的东西是什么」。
 * 缺省不跟随，文件树才能把链接显示成链接。
 */
export function buildStatCommand(
	remotePath: string,
	flavor: RemoteStatFlavor,
	options: { readonly followSymlinks?: boolean } = {},
): string {
	const quoted = quoteShellArgument(remotePath);
	const follow = options.followSymlinks ? " -L" : "";
	// `[ -e ]` 先判存在：不存在时直接退 0 并输出空，避免把 stat 的报错当成传输故障。
	return `[ -e ${quoted} ] && ${FORCE_C_LOCALE} stat${follow} ${statFormat(flavor)} ${quoted} || true`;
}

/** 解析符号链接与 `..` 后的真实路径；路径不存在时输出为空。 */
export function buildRealPathCommand(remotePath: string): string {
	const quoted = quoteShellArgument(remotePath);
	return `[ -e ${quoted} ] && readlink -f -- ${quoted} || true`;
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

/**
 * 原子写文件：内容从 stdin 进来，先落到目标同目录的临时文件，再 `mv` 过去。
 *
 * 同目录是必须的——`mv` 只有在同一文件系统内才是原子的，写到 /tmp 再 mv 会退化成
 * 「复制 + 删除」，中途失败会留下一个被截断的目标文件。
 *
 * 两件事不能丢，否则「改一行脚本」就会悄悄改变文件的性质：
 * - **权限位与属主**：临时文件先用 `cp -p` 从原文件克隆，再被 `cat >` 截断重写，
 *   截断不改 mode。直接新建的话文件按 umask 落成 0644，可执行脚本就丢了 `+x`。
 * - **符号链接**：先解析到真实文件再替换。对着链接本身 `mv` 会把链接换成普通文件，
 *   链接指向的那份则原封不动——用户看到的是「改了却没生效」。
 *
 * 整段交给 `/bin/sh`：sshd 用账号的登录 shell 解释命令串，而 fish 之类不认 POSIX 语法。
 */
export function buildWriteFileCommand(remotePath: string, temporarySuffix: string): string {
	const script = [
		`p=${quoteShellArgument(remotePath)}`,
		// readlink -f 在 GNU 与 macOS 12.3+ 都有；更老的 BSD 上失败就退回原路径。
		`t=$(readlink -f -- "$p" 2>/dev/null) || t=$p`,
		`[ -n "$t" ] || t=$p`,
		`tmp="$t"${quoteShellArgument(temporarySuffix)}`,
		`if [ -f "$t" ]; then cp -p -- "$t" "$tmp" || exit 1; fi`,
		`if cat > "$tmp" && mv -f -- "$tmp" "$t"; then exit 0; fi`,
		`rm -f -- "$tmp"`,
		"exit 1",
	].join("\n");
	return `/bin/sh -c ${quoteShellArgument(script)}`;
}

/** 远端「已存在」的退出码。取 EEXIST 的数值，便于调用方与本机的同名错误对齐。 */
export const REMOTE_ENTRY_EXISTS_EXIT_CODE = 17;

/**
 * 新建空文件或目录，目标已存在时以 {@link REMOTE_ENTRY_EXISTS_EXIT_CODE} 失败。
 *
 * 文件用 noclobber 重定向而不是「先判断再创建」：两步之间别人建了同名文件的话，后者会
 * 把它截断成空文件。
 */
export function buildCreateEntryCommand(remotePath: string, kind: "file" | "directory"): string {
	const quoted = quoteShellArgument(remotePath);
	const create = kind === "directory" ? `mkdir -- ${quoted}` : `( set -C; : > ${quoted} ) 2>/dev/null`;
	const script = [
		`if [ -e ${quoted} ] || [ -L ${quoted} ]; then exit ${REMOTE_ENTRY_EXISTS_EXIT_CODE}; fi`,
		create,
	].join("\n");
	return `/bin/sh -c ${quoteShellArgument(script)}`;
}

export interface ListFilesRecursiveOptions {
	/** 整个子树都跳过的目录名（`node_modules`、`dist` 之类）。点开头的条目总是跳过。 */
	readonly ignoredDirectoryNames: readonly string[];
	readonly limit: number;
}

/**
 * 递归列出普通文件，输出相对路径，一行一个。
 *
 * 一次 `find` 取回整棵树：逐层 readdir 在远端就是「目录数」次往返，稍大的仓库要几十秒。
 * `-mindepth 1` 是必须的——起点 `.` 本身也匹配 `.*`，不加的话整棵树在第一步就被剪掉。
 */
export function buildListFilesRecursiveCommand(remotePath: string, options: ListFilesRecursiveOptions): string {
	const pruned = [".*", ...options.ignoredDirectoryNames].map((name) => `-name ${quoteShellArgument(name)}`);
	const limit = Math.max(1, Math.floor(options.limit));
	const script = [
		`cd ${quoteShellArgument(remotePath)} || exit 1`,
		`find . -mindepth 1 \\( ${pruned.join(" -o ")} \\) -prune -o -type f -print | head -n ${limit}`,
	].join("\n");
	return `/bin/sh -c ${quoteShellArgument(script)}`;
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertEnvName(name: string): void {
	if (!ENV_NAME_PATTERN.test(name)) {
		throw new Error(`Invalid environment variable name: ${name}`);
	}
}
