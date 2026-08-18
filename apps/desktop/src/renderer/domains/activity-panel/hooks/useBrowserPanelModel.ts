import {
	activeSessionAtom,
	browserUrlBySessionAtom,
	getBrowserUrlForSession,
	setBrowserUrlForSessionAtom,
} from "@shared/store/atoms";
import type { BrowserPanelLabels } from "@vetta/theme-ui/activity";
import { useAtomValue, useSetAtom } from "jotai";
import { type FormEvent, type Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** 所有会话的内置浏览器共享一份持久 cookie/会话，登录一次到处复用。 */
const BROWSER_PARTITION = "persist:vetta-browser";

/** Electron <webview> 标签运行时方法的最小接口（仅声明本面板用到的）。 */
interface WebviewElement extends HTMLElement {
	canGoBack(): boolean;
	canGoForward(): boolean;
	goBack(): void;
	goForward(): void;
	reload(): void;
	stop(): void;
	loadURL(url: string): Promise<void>;
	getURL(): string;
}

/** 把地址栏输入规整为可加载的 URL：已带协议直接用，否则补 https://，空则返回 null。 */
function normalizeUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

export interface BrowserPanelModel {
	sessionPath: string | null;
	labels: BrowserPanelLabels;
	address: string;
	canBack: boolean;
	canForward: boolean;
	loading: boolean;
	failed: boolean;
	hasPage: boolean;
	currentUrl: string;
	partition: string;
	webviewRef: Ref<HTMLElement>;
	onAddressChange: (value: string) => void;
	onAddressSubmit: (event: FormEvent) => void;
	onBack: () => void;
	onForward: () => void;
	onStop: () => void;
	onReload: () => void;
	onOpenExternal: () => void;
	onRetry: () => void;
}

export function useBrowserPanelModel(): BrowserPanelModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const sessionPath = activeSession?.sessionPath ?? null;
	const urlMap = useAtomValue(browserUrlBySessionAtom);
	const targetUrl = getBrowserUrlForSession(urlMap, sessionPath);
	const setSessionUrl = useSetAtom(setBrowserUrlForSessionAtom);

	const webviewRef = useRef<WebviewElement | null>(null);
	const readyRef = useRef(false);
	const pendingRef = useRef<string | null>(null);
	const [address, setAddress] = useState(targetUrl ?? "");
	const [currentUrl, setCurrentUrl] = useState(targetUrl ?? "");
	const [canBack, setCanBack] = useState(false);
	const [canForward, setCanForward] = useState(false);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);

	// 绑定 webview 事件：导航/加载状态同步到工具栏与会话记忆。
	useEffect(() => {
		const el = webviewRef.current;
		if (!el || !sessionPath) return;
		const syncNav = (): void => {
			setCanBack(el.canGoBack());
			setCanForward(el.canGoForward());
		};
		const onStart = (): void => {
			setLoading(true);
			setFailed(false);
		};
		const onStop = (): void => {
			setLoading(false);
			syncNav();
		};
		const onReady = (): void => {
			readyRef.current = true;
			const pending = pendingRef.current;
			pendingRef.current = null;
			if (pending && el.getURL() !== pending) void el.loadURL(pending).catch(() => setFailed(true));
		};
		const onNavigate = (event: Event): void => {
			const { url } = event as unknown as { url: string };
			// about:blank 是为挂载 guest 而设的占位初始页，不当作真实页面回写。
			if (url === "about:blank") return;
			setCurrentUrl(url);
			setAddress(url);
			syncNav();
			setSessionUrl({ sessionPath, url });
		};
		const onInPage = (event: Event): void => {
			const ev = event as unknown as { url: string; isMainFrame: boolean };
			if (!ev.isMainFrame || ev.url === "about:blank") return;
			setCurrentUrl(ev.url);
			setAddress(ev.url);
			syncNav();
			setSessionUrl({ sessionPath, url: ev.url });
		};
		const onFail = (event: Event): void => {
			// errorCode -3 (ABORTED) 多因重定向/手动停止，非真实失败，忽略。
			const ev = event as unknown as { errorCode: number; isMainFrame: boolean };
			if (ev.isMainFrame && ev.errorCode !== -3) {
				setLoading(false);
				setFailed(true);
			}
		};
		el.addEventListener("did-start-loading", onStart);
		el.addEventListener("did-stop-loading", onStop);
		el.addEventListener("dom-ready", onReady);
		el.addEventListener("did-navigate", onNavigate);
		el.addEventListener("did-navigate-in-page", onInPage);
		el.addEventListener("did-fail-load", onFail);
		return () => {
			el.removeEventListener("did-start-loading", onStart);
			el.removeEventListener("did-stop-loading", onStop);
			el.removeEventListener("dom-ready", onReady);
			el.removeEventListener("did-navigate", onNavigate);
			el.removeEventListener("did-navigate-in-page", onInPage);
			el.removeEventListener("did-fail-load", onFail);
		};
	}, [sessionPath, setSessionUrl]);

	// 外部 targetUrl 变化（点会话链接 / 地址栏导航）→ 与当前页不同则加载；未就绪先挂起。
	useEffect(() => {
		const el = webviewRef.current;
		if (!el || !targetUrl) return;
		if (!readyRef.current) {
			pendingRef.current = targetUrl;
			return;
		}
		if (el.getURL() !== targetUrl) void el.loadURL(targetUrl).catch(() => setFailed(true));
	}, [targetUrl]);

	const navigate = useCallback(
		(raw: string) => {
			const url = normalizeUrl(raw);
			if (!url || !sessionPath) return;
			setSessionUrl({ sessionPath, url });
		},
		[sessionPath, setSessionUrl],
	);

	const onAddressSubmit = useCallback(
		(event: FormEvent) => {
			event.preventDefault();
			navigate(address);
		},
		[address, navigate],
	);

	const retry = useCallback(() => {
		const el = webviewRef.current;
		if (!el) return;
		setFailed(false);
		el.reload();
	}, []);

	const openExternal = useCallback(() => {
		if (currentUrl) void window.vetta.auth.openExternal(currentUrl);
	}, [currentUrl]);

	const labels = useMemo(
		(): BrowserPanelLabels => ({
			noSession: t("browser.noSession"),
			back: t("browser.back"),
			forward: t("browser.forward"),
			stop: t("browser.stop"),
			reload: t("browser.reload"),
			addressPlaceholder: t("browser.addressPlaceholder"),
			openExternal: t("browser.openExternal"),
			empty: t("browser.empty"),
			loading: t("browser.loading"),
			failed: t("browser.failed"),
			retry: t("browser.retry"),
		}),
		[t],
	);

	return {
		sessionPath,
		labels,
		address,
		canBack,
		canForward,
		loading,
		failed,
		hasPage: currentUrl !== "" || targetUrl != null,
		currentUrl,
		partition: BROWSER_PARTITION,
		webviewRef: webviewRef as Ref<HTMLElement>,
		onAddressChange: setAddress,
		onAddressSubmit,
		onBack: () => webviewRef.current?.goBack(),
		onForward: () => webviewRef.current?.goForward(),
		onStop: () => webviewRef.current?.stop(),
		onReload: () => webviewRef.current?.reload(),
		onOpenExternal: openExternal,
		onRetry: retry,
	};
}
