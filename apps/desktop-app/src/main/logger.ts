import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import { inspect } from "node:util";
import { getVettaHomePath } from "@vetta/action-rpc";
import electronLog from "electron-log/main";
import { formatErrorChain, formatErrorChainJSON } from "./logger/format-error-chain.js";
import { enforceRetention } from "./logger/log-retention.js";
import { logRingBuffer, type RingEntry } from "./logger/log-ring-buffer.js";
import { detectProcessRole, roleFileSuffix } from "./logger/process-role.js";

export type AppLogLevel = "log" | "info" | "warn" | "error";
export type AppLogType = "main" | "render" | "im";

const APP_LOG_MAX_SIZE = 5 * 1024 * 1024;
const APP_LOG_RETENTION_DAYS = 10;
// 单 type 目录的硬上限：失控写入时按"归档数 + 总字节"双上限封顶，防止单天写爆磁盘。
const APP_LOG_MAX_ARCHIVE_COUNT = 50;
const APP_LOG_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const APP_LOG_ROTATION_FALLBACK_SIZE = 256 * 1024;
const APP_LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const APP_LOG_TIME_ZONE = "Asia/Shanghai";
const APP_LOG_DIR = join(getVettaHomePath(), "desktop-app", "logs");
const APP_LOG_TYPES: readonly AppLogType[] = ["main", "render", "im"];
const FILE_SUFFIX = roleFileSuffix(detectProcessRole());
// agent-rpc 子进程的 stdout 跑 coding-agent 的 RPC NDJSON 协议，绝不能镜像日志到
// console——electron-log 的 node console transport 在 require 时就快照了原始
// console.*（→ 真实 stdout），main.ts 把 console 改写为 stderr 对它无效，dev 下
// agent-rpc 继承 VETTA_DESKTOP_DEV_URL 会让镜像打开并污染协议。故与角色解耦。
const SHOULD_MIRROR_LOGS_TO_CONSOLE =
	process.env.VETTA_DESKTOP_DEV_URL !== undefined && detectProcessRole() !== "agent-rpc";

let appLoggingConfigured = false;
let consolePatched = false;
let inLoggerWrite = false;
let logCleanupTimer: NodeJS.Timeout | undefined;

type AppLogger = ReturnType<typeof electronLog.scope>;
type ElectronLogger = typeof electronLog;
type LogFile = ReturnType<typeof electronLog.transports.file.getFile>;

const loggers = new Map<AppLogType, ElectronLogger>();

export function configureAppLogging(): void {
	if (appLoggingConfigured) return;
	appLoggingConfigured = true;

	electronLog.initialize({ preload: false, spyRendererConsole: false });
	for (const type of APP_LOG_TYPES) {
		const logger = type === "main" ? electronLog : electronLog.create({ logId: `app-${type}` });
		configureLogger(logger, type);
		loggers.set(type, logger);
	}

	archiveLegacyMainLog();
	cleanupAllLogDirectories();
	startLogCleanupTimer();
}

export function getAppLogger(scope: string, type: AppLogType = "main"): AppLogger {
	configureAppLogging();
	return getLogger(type).scope(scope);
}

export function getAppLogPath(type: AppLogType = "main"): string {
	configureAppLogging();
	return getLogger(type).transports.file.getFile().path;
}

// 日志根目录（含 main/render/im 子目录），供诊断包打包遍历。
export function getAppLogBaseDir(): string {
	return APP_LOG_DIR;
}

export const APP_LOG_TYPE_LIST = APP_LOG_TYPES;

export function patchConsoleToAppLogger(): void {
	if (consolePatched) return;
	consolePatched = true;

	const logger = getAppLogger("console");
	// 重入护栏：patch 后的 console.* 指向 logger，而 logger 管线内部（transport、
	// 序列化、归档失败处理）若再触发 console.* 会回灌 logger，形成自反馈死循环
	// （这正是 "Render frame was disposed" 刷屏写爆磁盘的根因之一类）。同步标志保证
	// 内部再触发的 console.* 直接走原生 stderr，绝不回灌。file transport 是 sync 写，
	// 写盘同步完成、标志归位前的任何内部 console 都被拦——正是目标。
	const guard =
		(write: (...formatted: string[]) => void) =>
		(...args: unknown[]): void => {
			if (inLoggerWrite) {
				process.stderr.write(`[console-reentry] ${args.map(safeConsoleArg).join(" ")}\n`);
				return;
			}
			inLoggerWrite = true;
			try {
				write(...formatLogArgs(args));
			} finally {
				inLoggerWrite = false;
			}
		};
	console.log = guard((...a) => logger.info(...a));
	console.info = guard((...a) => logger.info(...a));
	console.warn = guard((...a) => logger.warn(...a));
	console.error = guard((...a) => logger.error(...a));
}

function safeConsoleArg(arg: unknown): string {
	if (typeof arg === "string") return arg;
	try {
		return inspect(arg, { depth: 2, breakLength: 160 });
	} catch {
		return "[unserializable]";
	}
}

export function writeAppLog(level: AppLogLevel, scope: string, ...args: unknown[]): void {
	const logger = getAppLogger(scope);
	const formatted = formatLogArgs(args);
	if (level === "error") {
		logger.error(...formatted);
	} else if (level === "warn") {
		logger.warn(...formatted);
	} else {
		logger.info(...formatted);
	}
}

function formatLogArgs(args: unknown[]): string[] {
	return args.map(formatLogArg);
}

function formatLogArg(arg: unknown): string {
	if (typeof arg === "string") return arg;
	if (arg instanceof Error) return formatErrorChain(arg);
	return inspect(arg, { depth: 8, breakLength: 160 });
}

function configureLogger(logger: ElectronLogger, type: AppLogType): void {
	logger.scope.labelPadding = 18;
	// 禁用 ipc transport：main 日志无需回传渲染进程。dev 下它默认开启，每条日志都会
	// webContents.send，而帧销毁竞态会让 Electron 抛 "Render frame was disposed" 并以
	// console.error 打印——console.error 已被 patch 成 logger.error，再次触发 ipc transport，
	// 形成自反馈死循环，瞬间写满数个 5MB 日志文件。关掉它即断环。
	logger.transports.ipc.level = false;
	logger.transports.file.setAppName("Vetta");
	// 角色化文件名：GUI 不带后缀（保持 `<日期>.log`），sidecar/CLI 带 role+pid，
	// 不再与主进程共写同一文件，消除并发追加与归档 rename 的竞态。
	logger.transports.file.fileName = `${type}${FILE_SUFFIX}.log`;
	logger.transports.file.resolvePathFn = (_variables, message) =>
		join(APP_LOG_DIR, type, `${formatChinaDateKey(message?.date ?? new Date())}${FILE_SUFFIX}.log`);
	logger.transports.file.level = type === "im" ? "debug" : "info";
	logger.transports.file.maxSize = APP_LOG_MAX_SIZE;
	logger.transports.file.format = ({ data, level, message }) => [
		`[${formatChinaLogTimestamp(message.date)}] [${level}] [${message.scope ?? ""}]`,
		...data,
	];
	logger.transports.file.inspectOptions = { depth: 8, breakLength: 160 };
	logger.transports.file.sync = true;
	logger.transports.file.archiveLogFn = archiveLogFile;
	logger.transports.console.level = SHOULD_MIRROR_LOGS_TO_CONSOLE ? "info" : false;
	if (SHOULD_MIRROR_LOGS_TO_CONSOLE) {
		logger.transports.console.format = ({ data, level, message }) => [
			`[${formatChinaLogTimestamp(message.date)}] [${level}] [${message.scope ?? ""}]`,
			...data,
		];
	}
	mountRingBufferTransport(logger);
}

type LogTransport = ElectronLogger["transports"]["ipc"];
type LogMessage = Parameters<LogTransport>[0];

// 结构化采集 transport：把每条消息转成 RingEntry 推进内存 ring buffer，供导出诊断
// 包时序列化为 NDJSON。只写内存、绝不写盘/写 stdout（agent-rpc 的 stdout 协议安全），
// 也绝不抛错。与 file transport 同级别过滤。
function mountRingBufferTransport(logger: ElectronLogger): void {
	const transport: LogTransport = Object.assign(
		(message: LogMessage) => {
			try {
				logRingBuffer.push(buildRingEntry(message));
			} catch {
				// Ring buffer must never break the log pipeline.
			}
		},
		{ level: logger.transports.file.level, transforms: [] as LogTransport["transforms"] },
	);
	logger.transports.ringbuffer = transport;
}

function buildRingEntry(message: LogMessage): RingEntry {
	const msgParts: string[] = [];
	let fields: Record<string, unknown> | undefined;
	let error: RingEntry["error"];
	for (const arg of message.data) {
		if (typeof arg === "string") {
			msgParts.push(arg);
		} else if (arg instanceof Error) {
			if (error === undefined) error = formatErrorChainJSON(arg);
			else msgParts.push(formatErrorChain(arg));
		} else if (Array.isArray(arg)) {
			// 数组不是结构化字段：展开成 {0:..,1:..} 会污染 fields，按可读串入 msg。
			msgParts.push(inspect(arg, { depth: 8, breakLength: 160 }));
		} else if (arg !== null && typeof arg === "object") {
			fields = { ...fields, ...(arg as Record<string, unknown>) };
		} else {
			msgParts.push(String(arg));
		}
	}
	return {
		ts: formatChinaLogTimestamp(message.date),
		level: String(message.level),
		scope: message.scope ?? "",
		msg: msgParts.join(" "),
		...(fields ? { fields } : {}),
		...(error ? { error } : {}),
	};
}

function getLogger(type: AppLogType): ElectronLogger {
	const logger = loggers.get(type);
	if (!logger) {
		throw new Error(`App logger is not configured for type: ${type}`);
	}
	return logger;
}

function startLogCleanupTimer(): void {
	if (logCleanupTimer !== undefined) return;
	logCleanupTimer = setInterval(cleanupAllLogDirectories, APP_LOG_CLEANUP_INTERVAL_MS);
	logCleanupTimer.unref?.();
}

function cleanupAllLogDirectories(): void {
	for (const type of APP_LOG_TYPES) {
		enforceLogRetention(join(APP_LOG_DIR, type));
	}
}

// 保留策略入口：当日活跃文件（本进程后缀）永不删，归档由日期 + 数量 + 字节三重上限回收。
function enforceLogRetention(dir: string): void {
	enforceRetention(dir, {
		retentionDays: APP_LOG_RETENTION_DAYS,
		maxTotalBytes: APP_LOG_MAX_TOTAL_BYTES,
		maxArchiveCount: APP_LOG_MAX_ARCHIVE_COUNT,
		currentDateKey: formatChinaDateKey(new Date()),
	});
}

function archiveLegacyMainLog(): void {
	const legacyPath = join(APP_LOG_DIR, "main.log");
	try {
		if (!existsSync(legacyPath) || statSync(legacyPath).size <= 0) return;
		const targetDir = join(APP_LOG_DIR, "main");
		mkdirSync(targetDir, { recursive: true });
		const archivePath = getAvailableArchivePath(targetDir, "legacy", ".log", "migration");
		renameSync(legacyPath, archivePath);
	} catch {
		// Best effort migration only. New writes never target main.log.
	}
}

function archiveLogFile(file: LogFile): void {
	try {
		if (!existsSync(file.path)) return;
		if (statSync(file.path).size <= 0) return;
		const pathParts = parse(file.path);
		const archivePath = getAvailableArchivePath(pathParts.dir, pathParts.name, pathParts.ext, "size");
		renameSync(file.path, archivePath);
		enforceLogRetention(pathParts.dir);
	} catch {
		// Preserve the newest part of the file instead of clearing all logs
		// when a platform temporarily prevents rename.
		cropLogFile(file.path);
	}
}

function cropLogFile(filePath: string): void {
	try {
		const content = readFileSync(filePath);
		const start = Math.max(0, content.length - APP_LOG_ROTATION_FALLBACK_SIZE);
		writeFileSync(filePath, content.subarray(start));
	} catch {
		// Keep the oversized file intact if even the fallback cannot run.
	}
}

function getAvailableArchivePath(dir: string, name: string, ext: string, reason: "size" | "migration"): string {
	const base = join(dir, `${name}.${formatChinaFileTimestamp(new Date())}.${reason}${ext}`);
	if (!existsSync(base)) return base;
	for (let index = 1; index < 1000; index += 1) {
		const candidate = join(dir, `${name}.${formatChinaFileTimestamp(new Date())}.${reason}.${index}${ext}`);
		if (!existsSync(candidate)) return candidate;
	}
	return base;
}

function formatChinaLogTimestamp(date: Date): string {
	return `${formatInChinaTimeZone(date, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		fractionalSecondDigits: 3,
		hourCycle: "h23",
	}).replace(" ", "T")}+08:00`;
}

function formatChinaFileTimestamp(date: Date): string {
	return `${formatInChinaTimeZone(date, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).replace(" ", "T")}+0800`;
}

function formatChinaDateKey(date: Date): string {
	return formatInChinaTimeZone(date, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
}

function formatInChinaTimeZone(date: Date, options: Intl.DateTimeFormatOptions): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		...options,
		timeZone: APP_LOG_TIME_ZONE,
	}).formatToParts(date);
	const values = new Map(parts.map((part) => [part.type, part.value]));
	const year = values.get("year") ?? "0000";
	const month = values.get("month") ?? "00";
	const day = values.get("day") ?? "00";
	if (options.hour === undefined) {
		return `${year}-${month}-${day}`;
	}
	const hour = values.get("hour") ?? "00";
	const minute = values.get("minute") ?? "00";
	const second = values.get("second") ?? "00";
	const millisecond = values.get("fractionalSecond") ?? "";
	return `${year}-${month}-${day} ${hour}:${minute}:${second}${millisecond ? `.${millisecond}` : ""}`;
}
