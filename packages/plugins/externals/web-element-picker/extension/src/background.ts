// background service worker（MV3 模块 worker）。
// 职责：
//   1. 汇总内核事件状态（active / count），供 popup 查询；
//   2. 授权门控：wep-start / 截图 / 发送给 AI 前校验授权码；
//   3. 截图：captureVisibleTab → downloads.download；
//   4. 下行命令转发：popup → 当前活动 tab 的 content script。
// chrome.* 全局声明见 chrome.d.ts（随 include 自动加载）
import publicJwk from "./license-public.jwk.json";
import { checkLicense } from "./license.ts";
import type { LicensePayload } from "./license.ts";

type LicenseRecord = LicensePayload & { code: string; activatedAt: number };

async function readLicense(): Promise<LicenseRecord | null> {
	const items = await chrome.storage.sync.get("wepLicense");
	return (items.wepLicense as LicenseRecord) ?? null;
}

async function isLicensed(): Promise<{ ok: boolean; order?: string; expire?: string }> {
	const record = await readLicense();
	if (!record) return { ok: false };
	return checkLicense(record.code, publicJwk);
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab ?? null;
}

// 向 tab 内 content script 发消息。无接收端（受限页面/未注入）时
// chrome.tabs.sendMessage 会 reject，这里吞掉并返回是否送达。
async function sendToTab(tabId: number, message: unknown): Promise<boolean> {
	try {
		await chrome.tabs.sendMessage(tabId, message);
		return true;
	} catch {
		return false;
	}
}

// ─── 截图：captureVisibleTab → Canvas 裁剪到选区 rect（内核传入） → 下载 ───
async function handleScreenshot(
	sender: { tab?: chrome.tabs.Tab },
	rect?: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const licensed = await isLicensed();
	if (!licensed.ok) {
		await chrome.storage.session.set({ wepNotice: "license-required" });
		return;
	}
	try {
		const fullDataUrl = await chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: "png" });
		let dataUrl = fullDataUrl;
		if (rect && rect.width > 0 && rect.height > 0) {
			const cropped = await cropImage(fullDataUrl, rect);
			if (cropped) dataUrl = cropped;
		}
		const filename = `wep-screenshot-${Date.now()}.png`;
		await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
		await chrome.storage.session.set({ wepNotice: "screenshot-saved" });
	} catch (error) {
		console.warn("[wep] screenshot failed:", error);
		await chrome.storage.session.set({ wepNotice: "screenshot-failed" });
	}
}

/** 在 Service Worker 中用 OffscreenCanvas 把全视口截图裁剪到选区 rect。 */
async function cropImage(
	dataUrl: string,
	rect: { x: number; y: number; width: number; height: number },
): Promise<string | null> {
	try {
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		const img = await createImageBitmap(blob);
		const canvas = new OffscreenCanvas(rect.width, rect.height);
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
		const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
		// MV3 service worker 中 URL.createObjectURL 不可用，用 data URL 返回
		const buffer = await croppedBlob.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
		return `data:image/png;base64,${btoa(binary)}`;
	} catch (error) {
		console.warn("[wep] cropImage failed:", error);
		return null;
	}
}

// ─── 发送给 AI：剪贴板交接（content script 已兜底写剪贴板），此处仅门控校验 ───
async function handleSendToAi(): Promise<void> {
	const licensed = await isLicensed();
	if (!licensed.ok) {
		await chrome.storage.session.set({ wepNotice: "license-required" });
		return;
	}
	await chrome.storage.session.set({ wepNotice: "send-to-ai-copied" });
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
	const m = message as {
		type?: string;
		msg?: {
			type?: string;
			count?: number;
			text?: string;
			rect?: { x: number; y: number; width: number; height: number };
		};
		settings?: { sharingan?: boolean; lang?: string };
	};
	const respond = (payload: unknown) => {
		sendResponse(payload);
		return true;
	};
	switch (m?.type) {
		case "wep-event": {
			const msg = m.msg;
			void (async () => {
				if (msg?.type === "mounted") {
					await chrome.storage.session.set({ wepActive: true, wepCount: 0, wepNotice: null });
				} else if (msg?.type === "destroyed") {
					await chrome.storage.session.set({ wepActive: false, wepCount: 0 });
				} else if (msg?.type === "mount-failed") {
					// 内核注入/初始化失败：popup 据此显示明确错误提示（而不是永远没反馈）。
					await chrome.storage.session.set({ wepActive: false, wepNotice: "mount-failed" });
				} else if (msg?.type === "selection-changed") {
					await chrome.storage.session.set({ wepCount: msg.count ?? 0 });
				}
				if (msg?.type === "screenshot") void handleScreenshot(sender, msg.rect);
				if (msg?.type === "send-to-ai") void handleSendToAi();
			})();
			return respond({ ok: true });
		}
		case "wep-start": {
			void (async () => {
				const licensed = await isLicensed();
				if (!licensed.ok) {
					await chrome.storage.session.set({ wepNotice: "license-required" });
					return respond({ ok: false, reason: "license-required" });
				}
				const tab = await activeTab();
				if (!tab?.id) return respond({ ok: false, reason: "no-tab" });
				await chrome.storage.session.set({ wepNotice: null });
				const delivered = await sendToTab(tab.id, { type: "wep-start" });
				if (!delivered) return respond({ ok: false, reason: "no-inject" });
				return respond({ ok: true });
			})();
			return true;
		}
		case "wep-stop": {
			void (async () => {
				const tab = await activeTab();
				if (!tab?.id) return respond({ ok: false, reason: "no-tab" });
				await sendToTab(tab.id, { type: "wep-stop" });
				return respond({ ok: true });
			})();
			return true;
		}
		case "wep-settings": {
			void (async () => {
				const settings = m.settings ?? {};
				// 同时写 session（popup 轮询读）和 sync（content script 持久化读），
				// 避免 popup 切换后页面刷新导致设置回退到旧值。
				const session = await chrome.storage.session.get("wepSettings");
				const sync = await chrome.storage.sync.get("wepSettings");
				const merged = {
					...((session.wepSettings as Record<string, unknown> | undefined) ?? {}),
					...((sync.wepSettings as Record<string, unknown> | undefined) ?? {}),
					...settings,
				};
				await Promise.all([
					chrome.storage.session.set({ wepSettings: merged }),
					chrome.storage.sync.set({ wepSettings: merged }),
				]);
				const tab = await activeTab();
				if (tab?.id) {
					await sendToTab(tab.id, {
						type: "wep-settings",
						settings,
					});
				}
				return respond({ ok: true });
			})();
			return true;
		}
		case "get-state": {
			void (async () => {
				const licensed = await isLicensed();
				const session = await chrome.storage.session.get([
					"wepActive",
					"wepCount",
					"wepNotice",
					"wepSettings",
				]);
				// session 在浏览器重启后清空：回退到 content script 持久化的 sync 设置。
				const sync = await chrome.storage.sync.get("wepSettings");
				const settings = session.wepSettings ?? sync.wepSettings ?? null;
				return respond({
					licensed: licensed.ok,
					order: licensed.order,
					expire: licensed.expire,
					active: Boolean(session.wepActive),
					count: (session.wepCount as number) ?? 0,
					notice: session.wepNotice ?? null,
					settings,
				});
			})();
			return true;
		}
	}
	return false;
});
