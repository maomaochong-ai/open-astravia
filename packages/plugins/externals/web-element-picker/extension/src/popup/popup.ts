// popup 控制面（原生 DOM，零框架）。
// 未激活：授权码激活表单 + 购买链接；已激活：开始/停止选择 + 写轮眼开关 + 状态。
// chrome.* 全局声明见 chrome.d.ts（随 include 自动加载）
import publicJwk from "../license-public.jwk.json";
import { checkLicense } from "../license.ts";

const $ = <T extends HTMLElement>(id: string): T => {
	const el = document.getElementById(id);
	if (!el) throw new Error(`missing #${id}`);
	return el as T;
};

const t = (name: string): string => chrome.i18n.getMessage(name) || name;

type State = {
	licensed: boolean;
	order?: string;
	expire?: string;
	active: boolean;
	count: number;
	notice: string | null;
	settings: { sharingan?: boolean; lang?: string } | null;
};

function fmtExpire(expire: string): string {
	return `${expire.slice(0, 4)}-${expire.slice(4, 6)}-${expire.slice(6, 8)}`;
}

function render(state: State): void {
	const licensedView = $("license-view");
	const controlView = $("control-view");
	licensedView.hidden = state.licensed;
	controlView.hidden = !state.licensed;

	if (!state.licensed) return;
	$("license-badge").textContent = t("licenseActivated");
	$("license-meta").textContent = `${t("orderLabel")} ${state.order ?? "—"} · ${t("expireLabel")} ${state.expire ? fmtExpire(state.expire) : "—"}`;

	const toggle = $<HTMLButtonElement>("toggle-btn");
	toggle.textContent = state.active ? t("stopSelecting") : t("startSelecting");
	toggle.classList.toggle("stop", state.active);
	toggle.disabled = false;

	const count = $("count-label");
	count.hidden = !state.active;
	count.textContent = state.active ? `✓ ${state.count}` : "";

	const sharingan = $<HTMLInputElement>("sharingan-input");
	sharingan.checked = Boolean(state.settings?.sharingan);

	const notice = $("notice");
	const noticeText = {
		"license-required": t("notLicensed"),
		"screenshot-saved": t("screenshotSaved"),
		"screenshot-failed": t("screenshotFailed"),
		"send-to-ai-copied": t("sendToAiHint"),
	}[state.notice ?? ""];
	if (noticeText) {
		notice.hidden = false;
		notice.textContent = noticeText;
	} else {
		notice.hidden = true;
	}
}

async function fetchState(): Promise<State> {
	return (await chrome.runtime.sendMessage({ type: "get-state" })) as State;
}

function bind(): void {
	$<HTMLButtonElement>("activate-btn").addEventListener("click", async () => {
		const code = $<HTMLInputElement>("license-input").value.trim();
		const error = $("license-error");
		error.hidden = true;
		if (!code) return;
		const result = await checkLicense(code, publicJwk);
		if (!result.ok) {
			error.textContent = t("licenseInvalid");
			error.hidden = false;
			return;
		}
		await chrome.storage.sync.set({
			wepLicense: { code, order: result.order, expire: result.expire, activatedAt: Date.now() },
		});
		render(await fetchState());
	});

	$<HTMLButtonElement>("toggle-btn").addEventListener("click", async () => {
		const state = await fetchState();
		const toggle = $<HTMLButtonElement>("toggle-btn");
		const actionError = $("action-error");
		toggle.disabled = true;
		let ok = true;
		if (state.active) {
			ok = (await chrome.runtime.sendMessage({ type: "wep-stop" })) !== false;
		} else {
			const result = (await chrome.runtime.sendMessage({ type: "wep-start" })) as
				| { ok?: boolean; reason?: string }
				| undefined;
			ok = Boolean(result?.ok);
			if (!ok) {
				const map: Record<string, string> = {
					"no-inject": t("errorNoInject"),
					"no-tab": t("errorNoTab"),
					"license-required": t("notLicensed"),
				};
				actionError.textContent = map[result?.reason ?? ""] ?? t("errorUnknown");
			}
		}
		actionError.hidden = ok;
		// 状态由内核事件异步回流，轮询刷新
		setTimeout(() => void refresh(), 400);
	});

	$<HTMLInputElement>("sharingan-input").addEventListener("change", (event) => {
		const next = (event.target as HTMLInputElement).checked;
		void chrome.runtime.sendMessage({ type: "wep-settings", settings: { sharingan: next } });
	});
}

let stopped = false;
async function refresh(): Promise<void> {
	if (stopped) return;
	render(await fetchState());
	setTimeout(() => void refresh(), 600);
}

void (async () => {
	document.title = t("popupTitle");
	$("title").textContent = t("popupTitle");
	$("version").textContent = `v${chrome.runtime.getManifest().version}`;
	$("license-title").textContent = t("licenseTitle");
	$("not-licensed").textContent = t("notLicensed");
	$<HTMLInputElement>("license-input").placeholder = t("licensePlaceholder");
	$("activate-btn").textContent = t("licenseActivate");
	$("buy-link").textContent = t("licenseBuy");
	$<HTMLAnchorElement>("buy-link").href = t("licenseBuyUrl");
	$("sharingan-label").textContent = t("sharinganLabel");
	$("sharingan-hint").textContent = t("sharinganHint");
	$("copy-hint-text").textContent = t("copyHint");
	$("footer").textContent = chrome.runtime.getManifest().name;

	bind();
	await refresh();

	// popup 关闭时停止轮询
	window.addEventListener("unload", () => {
		stopped = true;
	});
})();
