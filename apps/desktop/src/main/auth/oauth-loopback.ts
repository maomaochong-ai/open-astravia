/**
 * 开发模式下的 OAuth 回环（loopback）回调服务。
 *
 * 自定义 scheme 在开发模式的 macOS/Linux 上根本走不通：dev 跑的是
 * node_modules 里的 Electron.app（bundle id com.github.Electron，Info.plist
 * 没有 CFBundleURLTypes），LaunchServices 只会把 `vetta://` 派发给声明过该
 * scheme 的 bundle——也就是安装版 /Applications/Vetta.app。结果是门户回调
 * 拉起了另一个已安装的应用，开发中的实例永远收不到 token。
 * `app.setAsDefaultProtocolClient` 也救不了：macOS 上它只是把 scheme 的默认
 * handler 指向当前 bundle id，且系统拉起 bundle 时不会带上 dist/main/index.js
 * 这个 argv，即便注册成功也只会开出一个空的 Electron 窗口。
 *
 * 所以开发模式改走 OAuth 标准的 loopback 回调：主进程在 127.0.0.1 上监听一个
 * 临时端口，client_redirect 指向 http://127.0.0.1:<port>/oauth/callback。
 * 门户侧 /api/auth/deep-link-url 对 `to` 不限制 scheme，无需改动。
 * 打包后仍旧走 `vetta://`。
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("auth");

const CALLBACK_PATH = "/oauth/callback";

/** dev-only 页面，仅在开发者本机浏览器一闪而过，不进 i18n。 */
const RESPONSE_HTML = `<!doctype html><meta charset="utf-8"><title>Vetta</title><body style="font:16px system-ui;padding:48px">Authorized. You can close this window.</body>`;

let callbackUrl: string | null = null;
let handler: ((url: string) => void) | null = null;

/** 回调统一归一化成 `vetta://oauth/callback?…` 后交给主进程既有的处理入口。 */
export function setLoopbackCallbackHandler(fn: (url: string) => void): void {
	handler = fn;
}

/**
 * 惰性启动回环服务并返回回调地址；已启动则复用同一端口。
 * 服务常驻到进程退出（unref，不阻塞退出）。
 */
export function ensureLoopbackCallbackUrl(): Promise<string> {
	if (callbackUrl) return Promise.resolve(callbackUrl);

	return new Promise((resolve, reject) => {
		const next = createServer((req, res) => {
			const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
			if (requestUrl.pathname !== CALLBACK_PATH) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(RESPONSE_HTML);
			handler?.(`vetta://oauth/callback${requestUrl.search}`);
		});
		next.once("error", reject);
		next.listen(0, "127.0.0.1", () => {
			const { port } = next.address() as AddressInfo;
			callbackUrl = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
			next.unref();
			log.info(`开发模式 OAuth 回环回调已就绪：${callbackUrl}`);
			resolve(callbackUrl);
		});
	});
}
