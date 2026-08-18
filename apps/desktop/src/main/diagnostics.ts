import { createSocket } from "node:dgram";
import { createConnection } from "node:net";
import { app, net } from "electron";
import {
	type AppLogLevel,
	configureAppLogging,
	getAppLogger,
	getAppLogPath,
	patchConsoleToAppLogger,
	writeAppLog,
} from "./logger.js";

let diagnosticsInstalled = false;
const diagnosticsLog = getAppLogger("diagnostics");

export function writeDiagnosticLog(level: AppLogLevel, ...args: unknown[]): void {
	try {
		writeAppLog(level, "diagnostics", ...args);
	} catch {
		// Logging must never become a startup failure.
	}
}

export function getDiagnosticsLogPath(): string {
	return getAppLogPath();
}

// macOS 14+/15+ 的 Local Network Privacy 在 app 第一次访问局域网（192.168.x、
// 10.x、mDNS 等）时会弹"允许查找并连接本地网络上的设备"对话框，未授权时所有
// 局域网请求被静默拒绝并返回 EHOSTUNREACH（errno -65），表现为 OpenAI / Anthropic
// SDK 抛 "Connection error."。
//
// 触发条件：(1) Info.plist 必须声明 NSLocalNetworkUsageDescription +
// NSBonjourServices，(2) app 必须实际发起 *被内核识别为本地网络访问* 的 syscall。
// 仅靠 mDNS 多播在新版 macOS 上不稳：内核常常不把多播 send 记入"本地网络访问"，
// 导致 app 一直进不了「系统设置 → 隐私与安全性 → 本地网络」列表，用户无法授权。
//
// 实测稳定的做法是 **主动 unicast TCP connect 到 RFC1918 私网地址**。即使连接
// 失败（端口拒绝 / 不可达 / 超时）都没关系，内核已经把这次 connect syscall
// 记为本地网络访问，TCC 就会把 app 注册进列表。多打几个不同私网段确保命中。
// mDNS 多播保留作为辅助。
//
// 必须在 app.whenReady() 之后调用，否则主进程的 bundle identity 还没在
// launchd / TCC 子系统里就位，syscall 关联不到 com.vetta.desktop。
const UNICAST_PROBE_TARGETS: ReadonlyArray<{ host: string; port: number }> = [
	{ host: "192.168.0.1", port: 1 },
	{ host: "10.0.0.1", port: 1 },
	{ host: "172.16.0.1", port: 1 },
];

function probeUnicastLocalNetwork(): void {
	for (const target of UNICAST_PROBE_TARGETS) {
		try {
			const socket = createConnection({ host: target.host, port: target.port });
			socket.setTimeout(500);
			const cleanup = () => {
				try {
					socket.destroy();
				} catch {
					// already destroyed
				}
			};
			socket.once("connect", () => {
				diagnosticsLog.debug("unicast connected", target);
				cleanup();
			});
			socket.once("error", (err: NodeJS.ErrnoException) => {
				// 期望大概率失败 —— ECONNREFUSED / EHOSTUNREACH / ETIMEDOUT 都算
				// 成功触发了内核记录，只看 syscall 是否发出。
				diagnosticsLog.debug("unicast attempt", target, err.code ?? err.message);
				cleanup();
			});
			socket.once("timeout", () => {
				diagnosticsLog.debug("unicast timeout", target);
				cleanup();
			});
		} catch (err) {
			diagnosticsLog.warn("unicast probe threw", target, err);
		}
	}
}

function probeMulticastLocalNetwork(): void {
	try {
		const socket = createSocket({ type: "udp4", reuseAddr: true });
		socket.on("error", (err) => {
			diagnosticsLog.warn("mDNS probe socket error", err);
			try {
				socket.close();
			} catch {
				// already closed
			}
		});
		socket.bind(0, () => {
			try {
				socket.setMulticastTTL(1);
			} catch {
				// best effort
			}
			// 最小 DNS query header（12 字节全 0），mDNS 解析方会忽略。
			const probe = Buffer.alloc(12, 0);
			socket.send(probe, 5353, "224.0.0.251", (err) => {
				if (err) {
					diagnosticsLog.warn("mDNS probe send failed", err);
				} else {
					diagnosticsLog.debug("mDNS probe sent");
				}
				setTimeout(() => {
					try {
						socket.close();
					} catch {
						// already closed
					}
				}, 200);
			});
		});
	} catch (err) {
		diagnosticsLog.warn("failed to send mDNS probe", err);
	}
}

export function registerLocalNetworkAccess(): void {
	if (process.platform !== "darwin") return;
	probeUnicastLocalNetwork();
	probeMulticastLocalNetwork();
}

// macOS 15 (Sequoia) 的 Local Network Privacy 在 socket 层拦截私网访问，
// 但仅针对**直接调 BSD connect(2) 的网络栈**（Node undici / 裸 socket）。
// Electron 的 Chromium 网络栈走自己注册的网络客户端路径，不被同样拦截 ——
// 这也是为什么登录到 LAN 服务器（renderer fetch 走 Chromium）正常，
// 而 main 进程里的 OpenAI/Anthropic SDK 调用（默认用 Node undici）报
// EHOSTUNREACH 的原因。
//
// 这里把 main 进程的 globalThis.fetch 换成 electron.net.fetch，让所有
// 走全局 fetch 的 SDK（OpenAI / Anthropic / 自家代码）都自动走 Chromium
// 网络栈，绕过 LNP 对裸 socket 的拦截。必须在 app.whenReady() 之后调用，
// 因为 net.fetch 依赖 session 初始化。
export function installChromiumFetchForMain(): void {
	if (typeof net?.fetch !== "function") {
		diagnosticsLog.warn("electron.net.fetch unavailable; keeping default fetch");
		return;
	}
	const chromiumFetch = net.fetch.bind(net);
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		try {
			return await chromiumFetch(input as Parameters<typeof net.fetch>[0], init);
		} catch (err) {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			try {
				const parsed = new URL(url);
				diagnosticsLog.error(
					"fetch failed",
					{ hostname: parsed.hostname, pathname: parsed.pathname, via: "chromium" },
					err,
				);
			} catch {
				diagnosticsLog.error("fetch failed (invalid url)", { url, via: "chromium" }, err);
			}
			throw err;
		}
	}) as typeof fetch;
	diagnosticsLog.info("swapped globalThis.fetch to electron.net.fetch (Chromium network stack)");
}

// 包裹 globalThis.fetch：fetch 失败时把请求 URL 和完整 cause 链记下来。诊断
// "Connection error." 必备：anthropic-ai-sdk / openai-node 在网络层失败时只会
// 抛 "Connection error." 占位文案，真正的 ECONNREFUSED / EHOSTUNREACH / DNS
// 错误都藏在底层 fetch 的 cause 里，不在这里捕获就拿不到。
function patchFetch(): void {
	const orig = globalThis.fetch;
	if (typeof orig !== "function") return;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		try {
			return await orig(input, init);
		} catch (err) {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			try {
				const parsed = new URL(url);
				diagnosticsLog.error("fetch failed", { hostname: parsed.hostname, pathname: parsed.pathname }, err);
			} catch {
				diagnosticsLog.error("fetch failed (invalid url)", { url }, err);
			}
			throw err;
		}
	}) as typeof fetch;
}

export function installMainDiagnostics(): void {
	if (diagnosticsInstalled) return;
	diagnosticsInstalled = true;

	configureAppLogging();
	patchConsoleToAppLogger();

	process.on("uncaughtException", (error) => {
		diagnosticsLog.error("uncaughtException", error);
	});

	process.on("unhandledRejection", (reason) => {
		diagnosticsLog.error("unhandledRejection", reason);
	});

	process.on("warning", (warning) => {
		diagnosticsLog.warn("process warning", warning);
	});

	app.on("render-process-gone", (_event, webContents, details) => {
		diagnosticsLog.error("render-process-gone", {
			id: webContents.id,
			url: webContents.getURL(),
			details,
		});
	});

	app.on("child-process-gone", (_event, details) => {
		diagnosticsLog.error("child-process-gone", details);
	});

	app.on("will-quit", (_event) => {
		diagnosticsLog.info("will-quit");
	});

	app.on("quit", (_event, exitCode) => {
		writeDiagnosticLog("log", "quit", { exitCode });
	});

	patchFetch();

	// 启动时打印关键 env —— 排查 "终端启动 OK / Finder 启动异常" 这类
	// launchd vs shell 环境差异问题（PATH / proxy / VETTA_SERVER_URL 等）的
	// 第一手依据。
	diagnosticsLog.info("startup", {
		version: app.getVersion(),
		platform: process.platform,
		arch: process.arch,
		node: process.versions.node,
		electron: process.versions.electron,
		execPath: process.execPath,
		cwd: process.cwd(),
		argv: process.argv,
		env: {
			PATH: process.env.PATH,
			SHELL: process.env.SHELL,
			HOME: process.env.HOME,
			LANG: process.env.LANG,
			hasHTTPProxy: !!(process.env.HTTP_PROXY ?? process.env.http_proxy),
			hasHTTPSProxy: !!(process.env.HTTPS_PROXY ?? process.env.https_proxy),
			hasAllProxy: !!(process.env.ALL_PROXY ?? process.env.all_proxy),
			NO_PROXY: process.env.NO_PROXY ?? process.env.no_proxy,
			VETTA_SERVER_URL: process.env.VETTA_SERVER_URL,
		},
	});
}
