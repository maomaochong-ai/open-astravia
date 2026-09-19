/**
 * Plan 模式下命令工具（bash / shell）的只读判定。
 *
 * 命令工具同时承载读与写，无法在工具面（schema）上二分，只能按命令内容放行。策略是 fail-closed 的
 * 白名单：认不出的程序、任何输出重定向、命令替换一律拒绝。宁可误拒——模型会收到原因并改用
 * read / grep / glob，而误放一条写命令就击穿了 Plan 模式的核心保证。
 */

export type PlanModeCommandVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

const ALLOWED: PlanModeCommandVerdict = Object.freeze({ allowed: true });

/** 无论参数如何都不产生副作用的程序。 */
const READ_ONLY_PROGRAMS = new Set([
	"basename",
	"cat",
	"cd",
	"column",
	"cut",
	"df",
	"diff",
	"dir",
	"dirname",
	"du",
	"echo",
	"egrep",
	"false",
	"fgrep",
	"file",
	"get-childitem",
	"get-content",
	"get-item",
	"get-location",
	"grep",
	"head",
	"id",
	"jq",
	"less",
	"ls",
	"more",
	"nl",
	"printenv",
	"printf",
	"ps",
	"pwd",
	"readlink",
	"realpath",
	"select-string",
	"stat",
	"tail",
	"test",
	"tr",
	"true",
	"type",
	"uname",
	"wc",
	"where",
	"whereis",
	"which",
	"whoami",
]);

/** 只有列出的子命令是只读的程序；值为允许的首个子命令集合。 */
const READ_ONLY_SUBCOMMANDS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
	Object.entries({
		git: new Set([
			"blame",
			"cat-file",
			"describe",
			"diff",
			"grep",
			"log",
			"ls-files",
			"ls-remote",
			"ls-tree",
			"merge-base",
			"rev-list",
			"rev-parse",
			"shortlog",
			"show",
			"status",
		]),
		npm: new Set(["ls", "list", "outdated", "view", "why"]),
		pnpm: new Set(["ls", "list", "outdated", "why"]),
		yarn: new Set(["list", "why", "info"]),
		cargo: new Set(["tree", "metadata"]),
		go: new Set(["list", "version", "env"]),
	}),
);

/** 仅当全部参数都是版本/帮助查询时放行的程序。 */
const VERSION_ONLY_PROGRAMS = new Set(["node", "python", "python3", "deno", "ruby", "java", "rustc", "tsc"]);
const VERSION_FLAGS = new Set(["--version", "-v", "-V", "--help", "-h", "version"]);

/**
 * 只读程序里仍会写盘或执行外部程序的参数；命中前缀即拒绝。
 * 例：`sort -o out`、`rg --pre cmd`、`git -c core.fsmonitor=cmd status`、`go env -w`。
 */
const MUTATING_ARGUMENT_PREFIXES: ReadonlyMap<string, readonly string[]> = new Map(
	Object.entries({
		find: ["-delete", "-exec", "-ok", "-fprint", "-fls"],
		fd: ["-x", "-X", "--exec"],
		rg: ["--pre"],
		sort: ["-o", "--output"],
		tree: ["-o"],
		date: ["-s", "--set"],
		git: ["-c", "--config-env", "--exec-path", "--output", "-O", "--open-files-in-pager"],
		go: ["-w", "-u"],
	}),
);

/** 多出的位置参数会被当作输出文件或新值的程序；值为允许的位置参数个数上限。 */
const POSITIONAL_LIMITS: ReadonlyMap<string, number> = new Map([
	["uniq", 1],
	["hostname", 0],
]);

export function classifyPlanModeCommand(command: string): PlanModeCommandVerdict {
	if (!command.trim()) return deny("the command is empty");
	const scan = scanCommand(command);
	if ("violation" in scan) return deny(scan.violation);
	for (const words of scan.segments) {
		const verdict = classifySegment(words);
		if (!verdict.allowed) return verdict;
	}
	return ALLOWED;
}

type CommandScan = { readonly segments: readonly (readonly string[])[] } | { readonly violation: string };

/**
 * 引号感知的单遍扫描：按未加引号的控制操作符切段，并在同一遍里发现重定向与命令替换。
 * 单引号内全部是字面量；双引号内 `$(` 与反引号仍会被 shell 展开，因此照样拒绝。
 */
function scanCommand(source: string): CommandScan {
	const segments: string[][] = [];
	let words: string[] = [];
	let word = "";
	let hasWord = false;
	let quote: "'" | '"' | undefined;

	const endWord = (): void => {
		if (hasWord) words.push(word);
		word = "";
		hasWord = false;
	};
	const endSegment = (): void => {
		endWord();
		if (words.length > 0) segments.push(words);
		words = [];
	};

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index]!;
		const next = source[index + 1];
		if (quote === "'") {
			if (char === "'") quote = undefined;
			else word += char;
			continue;
		}
		if (char === "`" || (char === "$" && next === "(")) {
			return { violation: "command substitution can hide arbitrary programs" };
		}
		if (quote === '"') {
			if (char === '"') quote = undefined;
			else if (char === "\\" && next !== undefined) {
				word += next;
				index += 1;
			} else word += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			hasWord = true;
			continue;
		}
		if (char === "\\" && next !== undefined) {
			word += next;
			hasWord = true;
			index += 1;
			continue;
		}
		if (char === ">" || char === "<") {
			if (next === "(") return { violation: "process substitution can hide arbitrary programs" };
			if (char === "<") {
				if (next === "<") return { violation: "here-documents are not allowed" };
				endWord();
				continue;
			}
			const harmless = /^>(&\d|\s*\/dev\/null(?![\w./-]))/.exec(source.slice(index));
			if (!harmless) return { violation: "output redirection writes to the filesystem" };
			// 重定向前紧贴的 fd 数字（2>&1 的 2）不是参数。
			if (/^\d+$/.test(word)) {
				word = "";
				hasWord = false;
			}
			endWord();
			index += harmless[0].length - 1;
			continue;
		}
		if (char === ";" || char === "\n" || char === "|" || char === "&") {
			endSegment();
			if ((char === "|" || char === "&") && next === char) index += 1;
			continue;
		}
		if (/\s/.test(char)) {
			endWord();
			continue;
		}
		word += char;
		hasWord = true;
	}
	if (quote) return { violation: "the command has an unterminated quote" };
	endSegment();
	return { segments };
}

function classifySegment(segmentWords: readonly string[]): PlanModeCommandVerdict {
	const firstProgramIndex = segmentWords.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
	if (firstProgramIndex < 0) return ALLOWED;
	const program = normalizeProgram(segmentWords[firstProgramIndex]);
	if (!program) return ALLOWED;
	const args = segmentWords.slice(firstProgramIndex + 1);

	const mutating = args.find((arg) =>
		MUTATING_ARGUMENT_PREFIXES.get(program)?.some((prefix) => arg.startsWith(prefix)),
	);
	if (mutating) return deny(`${program} ${mutating} can write files or execute programs`);
	const positionalLimit = POSITIONAL_LIMITS.get(program);
	if (positionalLimit !== undefined) {
		return args.filter((arg) => !arg.startsWith("-")).length <= positionalLimit
			? ALLOWED
			: deny(`${program} with extra arguments can write`);
	}
	const subcommands = READ_ONLY_SUBCOMMANDS.get(program);
	if (!subcommands && (READ_ONLY_PROGRAMS.has(program) || MUTATING_ARGUMENT_PREFIXES.has(program))) return ALLOWED;
	if (program === "sed") {
		return args.includes("-n") && !args.some((arg) => /^-[a-zA-Z]*i|^--in-place/.test(arg))
			? ALLOWED
			: deny("sed is only allowed as a read-only filter (sed -n, without -i)");
	}
	if (subcommands) {
		const subcommand = args.find((arg) => !arg.startsWith("-"));
		return subcommand && subcommands.has(subcommand)
			? ALLOWED
			: deny(`${[program, subcommand].filter(Boolean).join(" ")} is not a read-only subcommand`);
	}
	if (VERSION_ONLY_PROGRAMS.has(program)) {
		return args.length > 0 && args.every((arg) => VERSION_FLAGS.has(arg))
			? ALLOWED
			: deny(`${program} can execute arbitrary code`);
	}
	return deny(`${program} is not on the read-only command list`);
}

function normalizeProgram(word: string | undefined): string | undefined {
	if (!word) return undefined;
	const name = word.split(/[\\/]/).pop() ?? word;
	return name.replace(/\.exe$/i, "").toLowerCase();
}

function deny(reason: string): PlanModeCommandVerdict {
	return { allowed: false, reason };
}
