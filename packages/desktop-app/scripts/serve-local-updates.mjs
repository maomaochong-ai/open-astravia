import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// 本地更新通道的静态分发服务。
//
// 必须自己实现 Range，不能随手用一个静态服务器顶上：electron-updater 的差分下载
// 依赖 HTTP 206 逐段取字节，而 `python3 -m http.server` 之类的实现会无视 Range
// 头返回 200 全量，差分要么退化成全量、要么直接失败——测出来的结论是假的。
//
// 目录里会累积多个版本：差分需要读**旧版本**的 blockmap（URL 由新版号替换成旧版号
// 推出），因此发布新版本时只覆盖 latest-mac.yml，旧产物一律保留。

const defaultRoot = join(process.env.HOME ?? "", ".vetta", "local-updates");

function contentTypeFor(fileName) {
	const lower = fileName.toLowerCase();
	if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "application/yaml";
	if (lower.endsWith(".zip")) return "application/zip";
	if (lower.endsWith(".dmg")) return "application/x-apple-diskimage";
	return "application/octet-stream";
}

/** 解析单区间 Range 头，返回 undefined 表示按全量响应。 */
export function parseRange(rangeHeader, size) {
	if (typeof rangeHeader !== "string") return undefined;
	const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
	if (!match) return undefined;
	const [, rawStart, rawEnd] = match;
	if (rawStart === "" && rawEnd === "") return undefined;

	// `bytes=-N` 表示最后 N 个字节
	if (rawStart === "") {
		const suffix = Number(rawEnd);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}

	const start = Number(rawStart);
	const end = rawEnd === "" ? size - 1 : Number(rawEnd);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { invalid: true };
	if (start > end || start >= size) return { invalid: true };
	return { start, end: Math.min(end, size - 1) };
}

function resolveWithinRoot(root, requestPath) {
	const decoded = decodeURIComponent(requestPath.split("?")[0]);
	const candidate = resolve(root, `.${normalize(decoded)}`);
	// 目录穿越防护：解析后必须仍在 root 之内
	return candidate === root || candidate.startsWith(`${root}/`) ? candidate : undefined;
}

export function createLocalUpdateServer(root) {
	return createServer(async (request, response) => {
		const filePath = resolveWithinRoot(root, request.url ?? "/");
		if (!filePath) {
			response.writeHead(403).end();
			return;
		}

		const info = await stat(filePath).catch(() => undefined);
		if (!info?.isFile()) {
			response.writeHead(404).end();
			return;
		}

		const range = parseRange(request.headers.range, info.size);
		if (range?.invalid) {
			response.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
			return;
		}

		const headers = {
			"Content-Type": contentTypeFor(filePath),
			"Accept-Ranges": "bytes",
			"Cache-Control": "no-store",
		};

		if (!range) {
			console.log(`200 ${basename(filePath)} (${info.size} bytes)`);
			response.writeHead(200, { ...headers, "Content-Length": info.size });
			if (request.method === "HEAD") return response.end();
			createReadStream(filePath).pipe(response);
			return;
		}

		const length = range.end - range.start + 1;
		console.log(`206 ${basename(filePath)} bytes=${range.start}-${range.end} (${length} bytes)`);
		response.writeHead(206, {
			...headers,
			"Content-Length": length,
			"Content-Range": `bytes ${range.start}-${range.end}/${info.size}`,
		});
		if (request.method === "HEAD") return response.end();
		createReadStream(filePath, { start: range.start, end: range.end }).pipe(response);
	});
}

export async function main() {
	const root = resolve(process.env.VETTA_LOCAL_UPDATE_DIR || defaultRoot);
	const port = Number(process.env.VETTA_LOCAL_UPDATE_PORT || 8080);
	const entries = await readdir(root).catch(() => undefined);
	if (!entries) {
		throw new Error(`[serve-local-updates] 分发目录不存在：${root}（先跑 scripts/release-mac.sh local）`);
	}

	createLocalUpdateServer(root).listen(port, "127.0.0.1", () => {
		console.log(`[serve-local-updates] http://127.0.0.1:${port} -> ${root}`);
		const manifests = entries.filter((entry) => entry.startsWith("latest"));
		const packages = entries.filter((entry) => entry.endsWith(".zip"));
		console.log(`[serve-local-updates] 清单 ${manifests.join(", ") || "无"}；累积 ${packages.length} 个更新包`);
		console.log("[serve-local-updates] 支持 Range 请求（差分下载必需），Ctrl+C 结束");
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
