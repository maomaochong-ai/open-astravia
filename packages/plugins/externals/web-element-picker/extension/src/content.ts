// content script（isolated world，document_start 注入，<all_urls>）。
// 职责：
//   1. 注入主世界内核（<script src=chrome-extension://…/kernel-inject.js>，经 web_accessible_resources 放行）；
//   2. 消息中继：主世界 __wepEvent → chrome.runtime.sendMessage（background 汇总状态）；
//   3. 命令下行：popup/background 的 wep-start / wep-stop / wep-settings / wep-lang → 主世界 __wepCmd；
//   4. 导航恢复：storage 中 wepSelecting=true 时自动重新挂载（等价桌面 reconcileLoad）；
//   5. 剪贴板兜底：主世界直写失败时（copy / send-to-ai）用扩展 clipboardWrite 权限补写。

// chrome.* 全局声明见 chrome.d.ts（随 include 自动加载）

const INJECT_URL = chrome.runtime.getURL("kernel-inject.js");

type WepSettings = { lang?: string; sharingan?: boolean };

function getSettings(): Promise<WepSettings> {
	return chrome.storage.sync.get("wepSettings").then((items) => (items.wepSettings as WepSettings) ?? {});
}

function resolveLang(settings: WepSettings): string {
	return settings.lang ?? (chrome.i18n.getUILanguage().toLowerCase().startsWith("zh") ? "zh" : "en");
}

function sendCommand(cmd: unknown): void {
	window.postMessage(cmd, "*");
}

/** 注入主世界内核脚本；返回是否已就位（data-wep-injected 标记存在）。 */
function ensureInjected(): boolean {
	const root = document.documentElement ?? document;
	if (root.hasAttribute("data-wep-injected")) return true;
	const script = document.createElement("script");
	script.src = INJECT_URL;
	(document.head ?? document.documentElement ?? document).appendChild(script);
	return false;
}

/** 轮询等待主世界内核就绪（脚本异步加载）。 */
function waitReady(timeoutMs = 2000): Promise<boolean> {
	return new Promise((resolve) => {
		const start = Date.now();
		const tick = () => {
			const root = document.documentElement ?? document;
			if (root.hasAttribute("data-wep-injected")) return resolve(true);
			if (Date.now() - start > timeoutMs) return resolve(false);
			setTimeout(tick, 50);
		};
		tick();
	});
}

async function mount(): Promise<void> {
	ensureInjected();
	if (!(await waitReady())) return;
	const settings = await getSettings();
	const lang = resolveLang(settings);
	sendCommand({ __wepCmd: "mount", lang, settings: { sharingan: Boolean(settings.sharingan) } });
	await chrome.storage.sync.set({ wepSelecting: true });
}

async function stop(): Promise<void> {
	sendCommand({ __wepCmd: "destroy" });
	await chrome.storage.sync.set({ wepSelecting: false });
}

// ─── 事件上行 + 剪贴板兜底：主世界内核事件 → background；copy/send-to-ai 时用
// 扩展 clipboardWrite 权限补写（主世界直写失败时兜底；成功时重复写入幂等无害）───
window.addEventListener("message", (event: MessageEvent<unknown>) => {
	const data = event.data as { __wepEvent?: { type?: string; text?: string } } | null;
	if (!data || typeof data !== "object" || !("__wepEvent" in data)) return;
	const msg = data.__wepEvent;
	void chrome.runtime.sendMessage({ type: "wep-event", msg });
	if (msg && (msg.type === "copy" || msg.type === "send-to-ai") && msg.text) {
		void navigator.clipboard?.writeText(msg.text).catch(() => undefined);
	}
});

// ─── 命令下行：popup / background → 主世界 ───
chrome.runtime.onMessage.addListener((message: unknown) => {
	const m = message as { type?: string };
	switch (m?.type) {
		case "wep-start":
			void mount();
			break;
		case "wep-stop":
			void stop();
			break;
		case "wep-settings": {
			const settings = (m as { settings?: WepSettings }).settings;
			if (settings) {
				void getSettings().then((current) =>
					chrome.storage.sync.set({ wepSettings: { ...current, ...settings } }),
				);
				sendCommand({ __wepCmd: "applySettings", settings: { sharingan: Boolean(settings.sharingan) } });
			}
			break;
		}
		case "wep-lang": {
			const lang = (m as { lang?: string }).lang;
			if (lang) sendCommand({ __wepCmd: "applyLang", lang });
			break;
		}
	}
});

// ─── 设置变更（popup 切换写轮眼/语言）→ 实时应用到主世界 ───
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "sync") return;
	const next = changes.wepSettings?.newValue as WepSettings | undefined;
	if (next) {
		sendCommand({ __wepCmd: "applySettings", settings: { sharingan: Boolean(next.sharingan) } });
		if (next.lang) sendCommand({ __wepCmd: "applyLang", lang: next.lang });
	}
});


// ─── 首次注入 + 导航恢复 ───
void (async () => {
	ensureInjected();
	const ready = await waitReady();
	if (!ready) return;
	if (!document.documentElement.hasAttribute("data-wep-injected")) {
		// 极早期注入失败兜底
		ensureInjected();
	}
	const items = await chrome.storage.sync.get("wepSelecting");
	if (items.wepSelecting) {
		const settings = await getSettings();
		const lang = resolveLang(settings);
		sendCommand({ __wepCmd: "mount", lang, settings: { sharingan: Boolean(settings.sharingan) } });
	}
})();
