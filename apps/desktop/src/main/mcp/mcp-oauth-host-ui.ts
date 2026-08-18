import { createServer, type Server } from "node:http";
import type { McpDeviceCodeInfo, McpOAuthCallbackSession } from "@vetta/runtime-mcp";
import { mainT } from "../i18n/index.js";

export async function createOAuthCallbackSession(): Promise<McpOAuthCallbackSession> {
	let resolveCode: ((code: string) => void) | undefined;
	let rejectCode: ((error: Error) => void) | undefined;
	let pendingCode: string | undefined;
	let pendingError: Error | undefined;
	let settled = false;

	const server: Server = createServer((request, response) => {
		try {
			const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
			if (requestUrl.pathname === "/favicon.ico") {
				response.writeHead(404);
				response.end();
				return;
			}
			const code = requestUrl.searchParams.get("code");
			const error = requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
			if (code) {
				const html = renderBrowserResultPage(true);
				response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				response.end(html);
				if (resolveCode) {
					settled = true;
					resolveCode(code);
				} else {
					pendingCode = code;
				}
				return;
			}
			const message = error ?? mainT("mcpOAuth.missingAuthorizationCode");
			const html = renderBrowserResultPage(false, message);
			response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
			response.end(html);
			const authorizationError = new Error(`OAuth authorization failed: ${message}`);
			if (rejectCode) {
				settled = true;
				rejectCode(authorizationError);
			} else {
				pendingError = authorizationError;
			}
		} catch (error) {
			response.writeHead(500);
			response.end();
			const callbackError = error instanceof Error ? error : new Error(String(error));
			if (rejectCode) {
				settled = true;
				rejectCode(callbackError);
			} else {
				pendingError = callbackError;
			}
		}
	});

	const port = await listenOnLoopback(server, "mcpOAuth.callbackBindFailed");
	return {
		redirectUri: `http://127.0.0.1:${port}/callback`,
		waitForCode: (timeoutMs) =>
			new Promise<string>((resolve, reject) => {
				if (pendingError) {
					settled = true;
					return reject(pendingError);
				}
				if (pendingCode) {
					settled = true;
					return resolve(pendingCode);
				}
				if (settled) return reject(new Error(mainT("mcpOAuth.callbackAlreadySettled")));
				const timer = setTimeout(() => {
					if (!settled) {
						settled = true;
						reject(new Error(mainT("mcpOAuth.callbackTimedOut")));
					}
				}, timeoutMs);
				resolveCode = (code) => {
					clearTimeout(timer);
					resolve(code);
				};
				rejectCode = (error) => {
					clearTimeout(timer);
					reject(error);
				};
			}),
		close: () => closeServer(server),
	};
}

export async function createDeviceCodePresentation(
	info: McpDeviceCodeInfo,
): Promise<{ url: string; close(): Promise<void> }> {
	const server: Server = createServer((request, response) => {
		if (request.url === "/favicon.ico") {
			response.writeHead(404);
			response.end();
			return;
		}
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		response.end(renderDeviceCodePage(info));
	});
	const port = await listenOnLoopback(server, "mcpOAuth.devicePageBindFailed");
	return { url: `http://127.0.0.1:${port}/`, close: () => closeServer(server) };
}

function renderBrowserResultPage(success: boolean, message?: string): string {
	const title = mainT(success ? "mcpOAuth.authorizationSuccessful" : "mcpOAuth.authorizationFailed");
	const detail = success
		? mainT("mcpOAuth.returnToVetta")
		: `${message ?? ""} ${mainT("mcpOAuth.closeAndRetry")}`.trim();
	return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>${success ? "<script>setTimeout(() => window.close(), 1500)</script>" : ""}</body></html>`;
}

function renderDeviceCodePage(info: McpDeviceCodeInfo): string {
	const verificationUri = info.verificationUriComplete ?? info.verificationUri;
	const userCode = JSON.stringify(info.userCode);
	return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(mainT("mcpOAuth.connectGitHub"))}</title></head><body style="font-family:system-ui,sans-serif;padding:2.5rem;text-align:center;background:#f6f8fa;color:#24292e"><h1 style="font-weight:600">${escapeHtml(mainT("mcpOAuth.connectGitHub"))}</h1><p>${escapeHtml(mainT("mcpOAuth.enterDeviceCode"))}</p><div style="font-family:ui-monospace,monospace;font-size:2.2rem;letter-spacing:.2rem;font-weight:700;margin:1.2rem 0;padding:.8rem 1.2rem;background:#fff;border:1px solid #d0d7de;border-radius:10px;display:inline-block">${escapeHtml(info.userCode)}</div><p><button id="copy">${escapeHtml(mainT("mcpOAuth.copyCode"))}</button></p><p><a href="${escapeHtml(verificationUri)}" target="_blank" rel="noopener">${escapeHtml(mainT("mcpOAuth.openGitHub"))}</a></p><p>${escapeHtml(mainT("mcpOAuth.closeAfterAuthorization"))}</p><script>navigator.clipboard && navigator.clipboard.writeText(${userCode}).catch(() => {});document.getElementById('copy').addEventListener('click', () => navigator.clipboard.writeText(${userCode}));</script></body></html>`;
}

function listenOnLoopback(server: Server, errorKey: string): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") return reject(new Error(mainT(errorKey)));
			resolve(address.port);
		});
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
