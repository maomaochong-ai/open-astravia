/**
 * 依赖未就绪时顶上的极小 MCP server。
 *
 * 为什么需要它：清单里的 `agent.mcpServers` 是**静态声明**，做不到「没装就不贡献」；而宿主的
 * runtime-mcp 不处理 `notifications/tools/list_changed`，也就没法先起个占位再热切换成真工具面。
 * 所以未就绪时必须有一个能正常握手的进程，否则宿主只会在日志里留一条启动失败，模型侧完全无感。
 *
 * 它只暴露一个工具：任何浏览器意图都会撞到它，然后拿到一句能转述给用户的引导。
 * 装好之后下一个新会话自然 spawn 到真的 `agent-browser mcp`，工具面前后不同是可接受的
 * ——安装前后本来就跨会话。
 */

import { MINIMUM_AGENT_BROWSER_VERSION } from "./version.mjs";

const PROTOCOL_VERSION = "2025-06-18";

const SETUP_TOOL = {
	name: "agent_browser_setup_required",
	title: "Browser setup required",
	description:
		"The browser automation runtime is not ready (missing or unusable), so no browser tool can run in this session. " +
		"Call this tool when the user asks to browse, open a web page, log into a site, or automate a browser. " +
		"It returns setup instructions that you MUST relay to the user.",
	inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

/** 就绪失败的具体原因，决定给模型的引导文案。 */
export function setupGuidance(reason, details = {}) {
	if (reason === "binary-missing") {
		return (
			"浏览器自动化运行时（agent-browser）尚未安装，所以本会话没有任何可用的浏览器工具。" +
			"请告诉用户：打开 Vetta 侧边栏的「浏览器操作」页面，点击「安装」完成一次性安装（会下载约 90MB 的运行时；" +
			"若系统未安装 Chrome，还需要额外下载 Chrome for Testing）。安装完成后新建一个会话即可使用浏览器工具。"
		);
	}
	if (reason === "version-too-old") {
		const found = details.version ? `检测到 ${details.version}` : "检测到的版本无法识别";
		return (
			`本机 PATH 上的 agent-browser 版本过旧（${found}，本插件需要 ${MINIMUM_AGENT_BROWSER_VERSION} 或更高），` +
			"因此本会话没有可用的浏览器工具。请告诉用户：打开 Vetta 侧边栏的「浏览器操作」页面点击「升级」，" +
			"插件会装一份自己锁定的版本，不会动用户已有的全局安装。升级后新建一个会话即可使用。"
		);
	}
	return (
		"浏览器自动化运行时当前不可用，本会话没有可用的浏览器工具。" +
		"请告诉用户：打开 Vetta 侧边栏的「浏览器操作」页面查看具体原因并重试安装。"
	);
}

function response(id, result) {
	return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function errorResponse(id, code, message) {
	return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * 处理一条 JSON-RPC 消息，返回要写回的字符串；通知（无 id）返回 null。
 * 抽成纯函数以便单测，不碰 stdio。
 */
export function handleStubMessage(message, reason, details = {}) {
	const id = message?.id;
	const method = message?.method;
	if (id === undefined || id === null) return null; // 通知不需要回包

	switch (method) {
		case "initialize":
			return response(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: "vetta-browser-setup", version: "1.0.0" },
			});
		case "tools/list":
			return response(id, { tools: [SETUP_TOOL] });
		case "tools/call":
			return response(id, {
				content: [{ type: "text", text: setupGuidance(reason, details) }],
				isError: true,
			});
		case "ping":
			return response(id, {});
		default:
			return errorResponse(id, -32601, `Method not found: ${String(method)}`);
	}
}

/** 在给定的 stdin/stdout 上跑 stub server（换行分隔的 JSON-RPC，与 MCP stdio 传输一致）。 */
export function runStubServer(reason, details = {}, input = process.stdin, output = process.stdout) {
	let buffer = "";
	input.setEncoding("utf8");
	input.on("data", (chunk) => {
		buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
			if (line.length === 0) continue;
			let parsed;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue; // 传输层噪声，忽略即可——回一个无 id 的错误反而会污染流
			}
			const reply = handleStubMessage(parsed, reason, details);
			if (reply !== null) output.write(`${reply}\n`);
		}
	});
	input.on("end", () => process.exit(0));
}
