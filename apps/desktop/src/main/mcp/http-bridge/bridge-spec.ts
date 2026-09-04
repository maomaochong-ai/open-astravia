/**
 * 受管二进制里有一类本身就是「本地 HTTP MCP 服务」（如小红书官方 server：只监听端口，
 * 没有 stdio 模式）。桥接进程按这份 spec 拉起它，再把 stdio 上的 MCP 流量转到它的 HTTP 端点。
 *
 * spec 由主进程在解析能力包时生成，作为一个 argv 传给桥接；里面只有本地路径和端口占位符。
 */

/** 端口在桥接启动时才分配，命令行与环境变量里用这个占位符声明它出现在哪儿。 */
export const PORT_TOKEN = `\${VETTA_MCP_PORT}`;

export interface HttpMcpBridgeSpec {
	readonly schemaVersion: 1;
	/** 要拉起的可执行文件绝对路径。 */
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd?: string;
	/** MCP 端点路径，如 `/mcp`。 */
	readonly path: string;
	/** 等待端口就绪的上限；首次运行可能要下载浏览器内核，默认给得比较宽。 */
	readonly readyTimeoutMs: number;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`bridge spec: ${field} must be a non-empty string`);
	return value;
}

export function parseHttpMcpBridgeSpec(raw: string): HttpMcpBridgeSpec {
	const parsed: unknown = JSON.parse(raw);
	if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("bridge spec: expected an object");
	}
	const spec = parsed as Record<string, unknown>;
	if (spec.schemaVersion !== 1) throw new Error("bridge spec: unsupported schemaVersion");
	const args = Array.isArray(spec.args) ? spec.args.map((value, index) => requireString(value, `args[${index}]`)) : [];
	const envInput = spec.env == null ? {} : spec.env;
	if (typeof envInput !== "object" || Array.isArray(envInput)) throw new Error("bridge spec: env must be an object");
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(envInput as Record<string, unknown>)) {
		env[key] = requireString(value, `env.${key}`);
	}
	const readyTimeoutMs =
		typeof spec.readyTimeoutMs === "number" && Number.isFinite(spec.readyTimeoutMs) && spec.readyTimeoutMs > 0
			? spec.readyTimeoutMs
			: 120_000;
	return {
		schemaVersion: 1,
		command: requireString(spec.command, "command"),
		args,
		env,
		...(spec.cwd === undefined ? {} : { cwd: requireString(spec.cwd, "cwd") }),
		path: requireString(spec.path, "path"),
		readyTimeoutMs,
	};
}

/** 端口占位符替换：命令行参数与环境变量各自可以出现任意次。 */
export function applyBridgePort(
	spec: HttpMcpBridgeSpec,
	port: number,
): { args: string[]; env: Record<string, string>; url: string } {
	const replace = (value: string): string => value.replaceAll(PORT_TOKEN, String(port));
	return {
		args: spec.args.map(replace),
		env: Object.fromEntries(Object.entries(spec.env).map(([key, value]) => [key, replace(value)])),
		url: `http://127.0.0.1:${port}${spec.path.startsWith("/") ? spec.path : `/${spec.path}`}`,
	};
}
