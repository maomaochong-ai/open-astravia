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

// ─── 截图：整页 captureVisibleTab + 下载 ───
async function handleScreenshot(sender: { tab?: chrome.tabs.Tab }): Promise<void> {
	const licensed = await isLicensed();
	if (!licensed.ok) {
		await chrome.storage.session.set({ wepNotice: "license-required" });
		return;
	}
	try {
		const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: "png" });
		const filename = `wep-screenshot-${Date.now()}.png`;
		await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
		await chrome.storage.session.set({ wepNotice: "screenshot-saved" });
	} catch (error) {
		console.warn("[wep] screenshot failed:", error);
		await chrome.storage.session.set({ wepNotice: "screenshot-failed" });
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
		msg?: { type?: string; count?: number; text?: string };
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
					await chrome.storage.session.set({ wepActive: true, wepCount: 0 });
				} else if (msg?.type === "destroyed") {
					await chrome.storage.session.set({ wepActive: false, wepCount: 0 });
				} else if (msg?.type === "selection-changed") {
					await chrome.storage.session.set({ wepCount: msg.count ?? 0 });
				}
				if (msg?.type === "screenshot") void handleScreenshot(sender);
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
				const tab = await activeTab();
				if (tab?.id) {
					await sendToTab(tab.id, {
						type: "wep-settings",
						settings: m.settings ?? {},
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
				return respond({
					licensed: licensed.ok,
					order: licensed.order,
					expire: licensed.expire,
					active: Boolean(session.wepActive),
					count: (session.wepCount as number) ?? 0,
					notice: session.wepNotice ?? null,
					settings: session.wepSettings ?? null,
				});
			})();
			return true;
		}
	}
	return false;
});
