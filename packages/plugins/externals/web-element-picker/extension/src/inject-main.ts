// 主世界桥（页面主世界执行；由 build-extension.mjs 拼接到内核 IIFE 之后，产物 kernel-inject.js）。
// 与 content script（isolated world）通过 window.postMessage 通信：
//   content → 主世界：{ __wepCmd: "mount" | "destroy" | "applySettings" | "applyLang", ... }
//   主世界 → content：{ __wepEvent: <内核事件对象> }
// 内核挂载时注入 WepBridge：post = (msg) => window.postMessage({ __wepEvent: msg }, "*")。
// 内核本身零改动，仅换桥（与桌面 consolePost 桥等价）。

declare global {
	interface Window {
		__WEP__?: {
			mount(options?: { lang?: string; bridge?: { post(message: unknown): void } }): void;
			destroy(): void;
			applyLang(lang: string): void;
			applySettings(settings: Record<string, unknown>): void;
			getContext(): string;
		};
		/** 内核挂载/销毁标记（挂载成功置 true，销毁或挂载失败回滚后置 false）。 */
		__WEP_ACTIVE__?: boolean;
	}
}

type WepCommand =
	| { __wepCmd: "mount"; lang?: string; settings?: Record<string, unknown> }
	| { __wepCmd: "destroy" }
	| { __wepCmd: "applySettings"; settings: Record<string, unknown> }
	| { __wepCmd: "applyLang"; lang: string };

const post = (message: unknown): void => {
	window.postMessage({ __wepEvent: message }, "*");
};

window.addEventListener("message", (event: MessageEvent<unknown>) => {
	const data = event.data as Partial<WepCommand> | null;
	if (!data || typeof data !== "object" || !data.__wepCmd) return;
	const cmd = data.__wepCmd;
	const wep = window.__WEP__;
	if (!wep) return;
	switch (cmd) {
		case "mount":
			wep.mount({ lang: data.lang, bridge: { post } });
			// 仅在内核挂载成功（__WEP_ACTIVE__=true）后应用设置，避免对回滚状态误调
			if (data.settings && window.__WEP_ACTIVE__) wep.applySettings(data.settings);
			break;
		case "destroy":
			wep.destroy();
			break;
		case "applySettings":
			if (data.settings) wep.applySettings(data.settings);
			break;
		case "applyLang":
			wep.applyLang(String(data.lang ?? ""));
			break;
	}
});

// 注入标记（content script 据此判断内核是否已就位；导航重载后属性消失 → 会重新注入）。
try {
	document.documentElement.setAttribute("data-wep-injected", "1");
} catch {
	// documentElement 尚不可用（document_start 极早期）时静默忽略，content script 会轮询重试
}

// 就绪探测：content script 发 ping，主世界回 pong。
window.addEventListener("message", (event: MessageEvent<unknown>) => {
	const data = event.data as { __wepPing?: boolean } | null;
	if (data && data.__wepPing) {
		window.postMessage({ __wepPong: true, ready: Boolean(window.__WEP__) }, "*");
	}
});

export {};
