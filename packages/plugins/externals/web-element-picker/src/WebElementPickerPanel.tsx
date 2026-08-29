import { useTranslation, type PluginContext } from "@astravia-org/plugin-sdk";
import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX, type KeyboardEvent } from "react";
import kernelCode from "./kernel/kernel-bundle.generated.ts";
import { consumePickerIntent, getPluginCtx, onPickerIntent } from "./plugin-context";

/** 复用内置浏览器的持久分区，登录态共享。 */
const BROWSER_PARTITION = "persist:astravia-browser";
const PLUGIN_ID = "web-element-picker";
// localStorage 键仅作升级路径保留（旧版本数据迁移后不再写入）。
const LAST_URL_KEY = "web-element-picker:lastUrl";
const SHARINGAN_SETTING_KEY = "web-element-picker:sharingan";
const BRIDGE_PREFIX = "[wep]";

/**
 * target=_blank 链接的「同窗跳转」不在页面内做拦截。
 *
 * Electron 34 的 WebviewTag 已无 `new-window` 事件可接管；此前注入页面内的
 * 锚点拦截（preventDefault + location.href）实测在 Electron 34 webview 中存在
 * 非确定性失败（location.href 赋值后不跳转，百度首页可稳定复现），且会抢在
 * 宿主 popup 重定向（window-manager.ts：did-attach-webview →
 * setWindowOpenHandler → 同 webview loadURL）之前拦截点击，导致点了没反应。
 *
 * 因此跳转完全交由宿主既有机制：allowpopups=true 放行 popup，main 进程把
 * target=_blank / window.open 重定向到同一 webview 加载（与内置浏览器一致，
 * 实测稳定）。选择内核激活时由内核 capture 点击并 preventDefault，天然不会
 * 触发 popup，故无需在此区分选择模式。
 */

interface WepBridgeMessage {
	type:
		| "mounted"
		| "destroyed"
		| "mount-failed"
		| "selection-changed"
		| "copy"
		| "send-to-ai"
		| "screenshot"
		| "open-settings";
	count?: number;
	text?: string;
	mime?: string;
	rect?: { x: number; y: number; width: number; height: number };
}

interface HostSettingsApi {
	astravia?: { plugins?: { setSettings?(id: string, values: Record<string, unknown>): Promise<void> } };
}

/** 写入宿主插件设置（设置页同一条链路，仅当 settings.write 已授权时调用）。 */
async function writeHostSettings(values: Record<string, unknown>): Promise<void> {
	const setSettings = (window as unknown as HostSettingsApi).astravia?.plugins?.setSettings;
	if (!setSettings) throw new Error("host settings api unavailable");
	await setSettings(PLUGIN_ID, values);
}

function normalizeUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

/** 宿主侧写剪贴板：navigator.clipboard 优先，execCommand 兜底。 */
async function writeClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		let ok = false;
		try {
			ok = document.execCommand("copy");
		} finally {
			textarea.remove();
		}
		return ok;
	}
}

/** 一次性探测当前是否有活跃会话（订阅后立即收到 replay 的 conversation-changed）。 */
// 订阅失败（如会话权限未授权）或回放迟迟不来时兜底 resolve(false)，
// 避免调用方 await 永久挂起（按钮停在「发送中…」）。
async function hasActiveConversation(ctx: PluginContext | null): Promise<boolean> {
	if (!ctx) return false;
	try {
		return await new Promise<boolean>((resolve) => {
			let settled = false;
			let sub: { dispose(): void } | null = null;
			const finish = (value: boolean): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				sub?.dispose();
				resolve(value);
			};
			const timer = setTimeout(() => finish(false), 3000);
			sub = ctx.conversation.on((event) => {
				if (event.type === "conversation-changed") finish(event.conversation.id !== null);
			});
		});
	} catch {
		// 权限缺失等订阅失败场景：返回 false，由调用方给出明确提示。
		return false;
	}
}

export function WebElementPickerPanel(): JSX.Element {
	const { t, locale } = useTranslation();
	const ctx = getPluginCtx();
	const webviewRef = useRef<WebviewTag | null>(null);
	const [address, setAddress] = useState("");
	const [currentUrl, setCurrentUrl] = useState("");
	const [canBack, setCanBack] = useState(false);
	const [canForward, setCanForward] = useState(false);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const [selecting, setSelecting] = useState(false);
	const [count, setCount] = useState(0);
	const [sending, setSending] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	// 写轮眼默认值：宿主设置（contributes.settings.sharingan）为准，localStorage 为升级路径。
	const [sharingan, setSharingan] = useState<boolean>(() => {
		const configured = ctx?.settings.get("sharingan");
		if (typeof configured === "boolean") return configured;
		return localStorage.getItem(SHARINGAN_SETTING_KEY) === "1";
	});
	const [settingsOpen, setSettingsOpen] = useState(false);
	const selectingRef = useRef(false);
	const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// webview 的 guest 是异步创建的：attach 前调用 getURL/loadURL 同步抛错，
	// 用挂起 URL + dom-ready 补发（reconcileLoad）自愈，不做 dom-ready 门控。
	const pendingUrlRef = useRef<string | null>(null);
	// 输入栏 toggle 发来的「开始选择」意图：等页面加载完成后再注入内核。
	const pendingSelectRef = useRef(false);

	selectingRef.current = selecting;

	const showToast = useCallback(
		(message: string) => {
			setToast(message);
			if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
			toastTimerRef.current = setTimeout(() => setToast(null), 2500);
		},
		[],
	);

	const syncNav = useCallback(() => {
		const el = webviewRef.current;
		if (!el) return;
		try {
			setCanBack(el.canGoBack());
			setCanForward(el.canGoForward());
		} catch {
			// webview 尚未 attach 时忽略，dom-ready 后再同步。
		}
	}, []);

	/** 最近访问地址持久化：插件 storage 为准，localStorage 为升级兜底。 */
	const saveLastUrl = useCallback(
		(url: string) => {
			void ctx?.storage
				.writeJson("lastUrl", url)
				.catch(() => localStorage.setItem(LAST_URL_KEY, url));
		},
		[ctx],
	);

	/** 注入内核 iife 并挂载（含持久化设置）。 */
	const injectKernel = useCallback(
		async (lang: string, sharinganOn: boolean) => {
			const el = webviewRef.current;
			if (!el) return;
			try {
				await el.executeJavaScript(
					`(() => { ${kernelCode} window.__WEP__?.mount({ lang: ${JSON.stringify(lang)} }); window.__WEP__?.applySettings?.({ sharingan: ${sharinganOn} }); })()`,
					true,
				);
			} catch (error) {
				// 多为导航竞态（did-navigate 早于新文档就绪）：页面内核未挂上，
				// 等 dom-ready 兜底重试，这里不复位宿主态以免打断连续选择。
				console.warn("[web-element-picker] inject failed:", error);
			}
		},
		[],
	);

	/** 卸载内核（页面内销毁浮层）。 */
	const destroyKernel = useCallback(async () => {
		const el = webviewRef.current;
		if (!el) return;
		try {
			await el.executeJavaScript("window.__WEP__?.destroy(); true", true);
		} catch {
			// 页面已被导航走时忽略。
		}
	}, []);

	const toggleSelecting = useCallback(() => {
		if (selectingRef.current) {
			// 本地先复位，不依赖页面回执（页面可能已导航导致 destroy 无响应）。
			setSelecting(false);
			setCount(0);
			void destroyKernel();
		} else {
			if (!currentUrl || failed) {
				showToast(t("panel.selectorNotReady"));
				return;
			}
			void injectKernel(locale, sharingan);
		}
	}, [currentUrl, destroyKernel, failed, injectKernel, locale, sharingan, showToast, t]);

	/** 发送选中元素上下文给 AI：先探测会话，再按复刻模式包装引导语。 */
	const sendContextToAi = useCallback(
		async (text: string): Promise<boolean> => {
			if (!text.trim()) return false;
			if (!ctx) {
				showToast(t("panel.sendFailed"));
				return false;
			}
			// 会话权限未授权时 on/sendPrompt 都会抛「Permission denied」，先预检给出明确指引。
			if (!ctx.permissions.has("agent.session.read") || !ctx.permissions.has("agent.session.write")) {
				showToast(t("panel.permissionDenied"));
				return false;
			}
			let active = false;
			try {
				active = await hasActiveConversation(ctx);
			} catch {
				active = false;
			}
			if (!active) {
				showToast(t("panel.noSession"));
				return false;
			}
			const prompt = sharingan
				? `The user wants to recreate the following web element faithfully. Use the recreation report below:\n\n${text}`
				: `The user picked web element(s) on the page and wants you to make code changes accordingly. Use the context below (each block may include an Instruction):\n\n${text}`;
			try {
				await ctx.conversation.sendPrompt(prompt);
				showToast(t("panel.sentToAi"));
				return true;
			} catch (error) {
				console.warn("[web-element-picker] sendPrompt failed:", error);
				showToast(t("panel.sendFailed"));
				return false;
			}
		},
		[ctx, sharingan, showToast, t],
	);

	/** 复刻模式开关：宿主设置持久化（设置页同链路），并实时下发运行中的内核。 */
	const applySharinganToKernel = useCallback((next: boolean) => {
		const el = webviewRef.current;
		if (el && selectingRef.current) {
			void el
				.executeJavaScript(`window.__WEP__?.applySettings?.({ sharingan: ${next} }); true`, true)
				.catch(() => undefined);
		}
	}, []);

	const toggleSharingan = useCallback(() => {
		const next = !sharingan;
		setSharingan(next);
		applySharinganToKernel(next);
		if (ctx?.permissions.has("settings.write")) {
			void writeHostSettings({ sharingan: next }).catch(() => {
				// 宿主设置写入失败（旧宿主无该链路等）：回退 localStorage，保证功能可用。
				localStorage.setItem(SHARINGAN_SETTING_KEY, next ? "1" : "0");
			});
		} else {
			localStorage.setItem(SHARINGAN_SETTING_KEY, next ? "1" : "0");
		}
	}, [applySharinganToKernel, ctx, sharingan]);

	/** 处理内核 console-message 桥。 */
	const onConsoleMessage = useCallback(
		(event: Event) => {
			const raw = (event as unknown as { message?: string }).message;
			if (!raw || !raw.startsWith(BRIDGE_PREFIX)) return;
			let msg: WepBridgeMessage;
			try {
				msg = JSON.parse(raw.slice(BRIDGE_PREFIX.length)) as WepBridgeMessage;
			} catch {
				return;
			}
			switch (msg.type) {
				case "mounted":
					setSelecting(true);
					setCount(0);
					break;
				case "destroyed":
					setSelecting(false);
					setCount(0);
					break;
				case "mount-failed":
					// 内核注入/初始化失败：宿主复位，给出可操作提示。
					setSelecting(false);
					setCount(0);
					showToast(t("panel.mountFailed"));
					break;
				case "selection-changed":
					setCount(msg.count ?? 0);
					break;
				case "copy": {
					if (msg.text) void writeClipboard(msg.text).then(() => showToast(t("panel.copyHint")));
					break;
				}
				case "screenshot": {
					const el = webviewRef.current;
					if (!el) return;
					// 先隐藏选择浮层（虚线框/选中框/工具栏），避免被截进图里。
					const hide = el.executeJavaScript(
						`document.getElementById("wep-root")?.style.setProperty("display", "none"); true`,
						true,
					);
					void hide
						.then(() => el.capturePage(msg.rect))
						.then(async (image) => {
							const dataUrl = image.toDataURL();
							const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
							const blobId = `screenshot-${Date.now()}`;
							const ref = await ctx?.storage.putBlob({
								id: blobId,
								data: base64,
								mimeType: "image/png",
							});
							if (ref) {
								// pro：挂一次性附件，下一次发送给 AI 时宿主自动合并 instructions/metadata。
								try {
									ctx?.ui.setPromptAttachment({
										id: blobId,
										label: t("panel.screenshotLabel"),
										instructions: [
											`The user captured the selected web element region as a screenshot. Read the image blob "${blobId}" from the plugin storage when you need it.`,
										],
										metadata: { blobId },
									});
								} catch {
									// 权限未授权等：附件挂载失败不影响截图本身已保存的提示。
								}
								showToast(t("panel.screenshotAttached"));
							} else {
								showToast(t("panel.screenshotFailed"));
							}
						})
						.catch(() => showToast(t("panel.screenshotFailed")))
						.finally(() => {
							// 截图后恢复浮层（页面可能已导航，忽略失败）。
							void el
								.executeJavaScript(
									`document.getElementById("wep-root")?.style.removeProperty("display"); true`,
									true,
								)
								.catch(() => undefined);
						});
					break;
				}
				case "send-to-ai": {
					if (!msg.text) break;
					setSending(true);
					void sendContextToAi(msg.text)
						.catch(() => showToast(t("panel.sendFailed")))
						.finally(() => setSending(false));
					break;
				}
				case "open-settings":
					setSettingsOpen(true);
					break;
			}
		},
		[ctx, sendContextToAi, showToast, t],
	);

	// ─── webview 事件（稳定绑定：handler 经 ref 取最新闭包，避免 locale/设置变化时
	// 解绑重绑造成 dom-ready 等事件错失——插件 Tab 每次切换都会重挂 webview）───
	const handlersRef = useRef<Record<string, (event: Event) => void>>({});

	// 自愈：guest 就绪/加载完成时若仍停在 about:blank 且有待加载地址，补发导航，
	// 兜住一切 dom-ready 错失竞态，杜绝「二次打开白屏」。
	const reconcileLoad = (): void => {
		const el = webviewRef.current;
		if (!el) return;
		const current = (() => {
			try {
				return el.getURL();
			} catch {
				return "about:blank";
			}
		})();
		if (current === "about:blank" || current === "") {
			const pending = pendingUrlRef.current;
			pendingUrlRef.current = null;
			if (pending) void el.loadURL(pending).catch(() => setFailed(true));
		}
	};

	handlersRef.current = {
		"dom-ready": () => {
			reconcileLoad();
			// 选择模式中导航：新文档就绪后重注入内核（did-navigate 的早注入可能失败）。
			if (selectingRef.current) void injectKernel(locale, sharingan);
		},
		"did-start-loading": () => {
			setLoading(true);
			setFailed(false);
		},
		"did-stop-loading": () => {
			setLoading(false);
			syncNav();
		},
		"did-navigate": (event) => {
			const { url } = event as unknown as { url: string };
			if (url === "about:blank") return;
			setCurrentUrl(url);
			setAddress(url);
			syncNav();
			saveLastUrl(url);
			// 选择模式中整页导航：页面内核已随文档销毁，自动重注入保持连续选择。
			if (selectingRef.current) void injectKernel(locale, sharingan);
		},
		"did-navigate-in-page": (event) => {
			const ev = event as unknown as { url: string; isMainFrame: boolean };
			if (!ev.isMainFrame || ev.url === "about:blank") return;
			setCurrentUrl(ev.url);
			setAddress(ev.url);
			syncNav();
			saveLastUrl(ev.url);
			if (selectingRef.current) void injectKernel(locale, sharingan);
		},
		"did-fail-load": (event) => {
			const ev = event as unknown as { errorCode: number; isMainFrame: boolean };
			if (ev.isMainFrame && ev.errorCode !== -3) {
				setLoading(false);
				setFailed(true);
			}
		},
		"render-process-gone": () => {
			// 渲染进程崩溃：复位全部状态，交由「重试」按钮恢复。
			setLoading(false);
			setFailed(true);
			setSelecting(false);
			setCount(0);
		},
		"did-finish-load": () => {
			reconcileLoad();
		},
		"console-message": onConsoleMessage,
	};

	useEffect(() => {
		const el = webviewRef.current;
		if (!el) return;
		const names = [
			"dom-ready",
			"did-start-loading",
			"did-stop-loading",
			"did-navigate",
			"did-navigate-in-page",
			"did-fail-load",
			"render-process-gone",
			"did-finish-load",
			"console-message",
		];
		const wrappers = new Map<string, EventListener>();
		for (const name of names) {
			const fn: EventListener = (event) => handlersRef.current[name]?.(event);
			wrappers.set(name, fn);
			el.addEventListener(name, fn);
		}
		return () => {
			for (const [name, fn] of wrappers) el.removeEventListener(name, fn);
		};
	}, []);

	// 导航：地址栏提交。
	const navigate = useCallback((raw: string) => {
		const url = normalizeUrl(raw);
		if (!url) return;
		const el = webviewRef.current;
		if (!el) {
			// 面板卸载/重挂间隙：不静默丢失用户输入，记录一次便于排查。
			console.warn("[web-element-picker] navigate skipped: webview not mounted");
			return;
		}
		// 直接导航，不等待 dom-ready：初始 about:blank 的 dom-ready 可能不触发/极慢
		// （Electron 34 打包版实测），用就绪门会把地址栏导航永久挂起（按了没反应）。
		// guest 未 attach 时 getURL/loadURL 同步抛错，转入挂起路径，由 dom-ready 的
		// reconcileLoad 兜底补发。
		let current = "";
		try {
			current = el.getURL();
		} catch {
			pendingUrlRef.current = url;
			return;
		}
		if (current !== url) {
			void el.loadURL(url).catch(() => setFailed(true));
		}
	}, []);

	const onAddressSubmit = (event: FormEvent) => {
		event.preventDefault();
		navigate(address);
	};

	// 地址栏显式回车：输入法合成中的回车（isComposing=true）不会提交表单且会被合成
	// 流程吞掉，导致「输入 URL 后按回车没反应」；合成结束后的回车直接导航，
	// 英文输入法下的回车也走这里（不依赖表单隐式提交）。
	const onAddressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Enter") return;
		if (event.nativeEvent.isComposing) return;
		event.preventDefault();
		navigate(address);
};

	// 初始加载：恢复上次浏览的地址（插件 storage，localStorage 为升级路径）。
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			let saved: string | null = null;
			try {
				saved = await ctx?.storage.readJson<string>("lastUrl") ?? null;
			} catch {
				saved = null;
			}
			if (cancelled) return;
			if (!saved) saved = localStorage.getItem(LAST_URL_KEY);
			if (saved) {
				setAddress(saved);
				navigate(saved);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [ctx, navigate]);

	// 语言跟随：宿主语言切换时同步内核词典。
	useEffect(() => {
		const el = webviewRef.current;
		if (!el || !selectingRef.current) return;
		void el.executeJavaScript(`window.__WEP__?.applyLang(${JSON.stringify(locale)}); true`, true);
	}, [locale]);

	// 宿主设置变更（设置页改写轮眼开关）→ 同步面板与运行中的内核。
	useEffect(() => {
		const settings = ctx?.settings;
		if (!settings) return;
		const sub = settings.onChange((values) => {
			if (typeof values.sharingan !== "boolean") return;
			setSharingan(values.sharingan);
			applySharinganToKernel(values.sharingan);
		});
		return () => sub.dispose();
	}, [applySharinganToKernel, ctx]);

	// 输入栏 toggle 意图：挂载时消费历史意图，运行中订阅新意图。
	useEffect(() => {
		const pending = consumePickerIntent();
		if (pending === "start-select") pendingSelectRef.current = true;
		if (pending === "stop-select") {
			setSelecting(false);
			setCount(0);
			void destroyKernel();
		}
		return onPickerIntent((intent) => {
			if (intent === "start-select") {
				pendingSelectRef.current = true;
			} else if (intent === "stop-select") {
				pendingSelectRef.current = false;
				setSelecting(false);
				setCount(0);
				void destroyKernel();
			}
		});
	}, [destroyKernel]);

	// 页面就绪后执行挂起的「开始选择」意图。
	useEffect(() => {
		if (pendingSelectRef.current && currentUrl && !failed && !selectingRef.current) {
			pendingSelectRef.current = false;
			void injectKernel(locale, sharingan);
		}
	}, [currentUrl, failed, injectKernel, locale, sharingan]);

	// 面板工具栏「发送给 AI」：从内核取上下文后经宿主 sendPrompt 发送。
	const sendToAi = useCallback(() => {
		const el = webviewRef.current;
		if (!el) return;
		if (count === 0) return;
		setSending(true);
		void el
			.executeJavaScript("window.__WEP__?.getContext?.() ?? ''", true)
			.then((text: unknown) => {
				if (typeof text !== "string" || !text.trim()) {
					showToast(t("panel.sendFailed"));
					return;
				}
				return sendContextToAi(text);
			})
			.catch(() => showToast(t("panel.sendFailed")))
			.finally(() => setSending(false));
	}, [count, sendContextToAi, showToast, t]);

	// 组件卸载时清理内核。
	useEffect(() => () => void destroyKernel(), [destroyKernel]);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			{/* 工具栏 */}
			<div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1.5 py-1.5">
				<button
					type="button"
					title={t("panel.back")}
					disabled={!canBack}
					onClick={() => webviewRef.current?.goBack()}
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
				>
					<span className="icon-[mdi--arrow-left] h-4 w-4" />
				</button>
				<button
					type="button"
					title={t("panel.forward")}
					disabled={!canForward}
					onClick={() => webviewRef.current?.goForward()}
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
				>
					<span className="icon-[mdi--arrow-right] h-4 w-4" />
				</button>
				{loading ? (
					<button
						type="button"
						title={t("panel.stop")}
						onClick={() => webviewRef.current?.stop()}
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
					>
						<span className="icon-[mdi--close] h-4 w-4" />
					</button>
				) : (
					<button
						type="button"
						title={t("panel.reload")}
						onClick={() => webviewRef.current?.reload()}
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
					>
						<span className="icon-[mdi--refresh] h-4 w-4" />
					</button>
				)}
				<form onSubmit={onAddressSubmit} className="min-w-0 flex-1">
					<input
						type="text"
						value={address}
						spellCheck={false}
						onKeyDown={onAddressKeyDown}
						placeholder={t("panel.addressPlaceholder")}
						onChange={(e) => setAddress(e.target.value)}
						className="h-7 w-full rounded-md border border-transparent bg-transparent px-2.5 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/40 focus:bg-background"
					/>
				</form>
				<button
					type="button"
					title={t("panel.openExternal")}
					disabled={!currentUrl || failed}
					onClick={() => {
						if (!currentUrl) return;
						void ctx?.ui
							.openExternal(currentUrl)
							.catch(() => showToast(t("panel.openExternalFailed")));
					}}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
				>
					<span className="icon-[mdi--open-in-new] h-4 w-4" />
				</button>
				<button
					type="button"
					title={selecting ? t("panel.stopSelecting") : t("panel.start")}
					disabled={failed}
					onClick={toggleSelecting}
					className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
						selecting
							? "bg-destructive/90 text-destructive-foreground hover:bg-destructive"
							: "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
					}`}
				>
					<span className={`h-4 w-4 ${selecting ? "icon-[mdi--stop]" : "icon-[mdi--crosshairs-gps]"}`} />
				</button>
				<button
					type="button"
					title={t("panel.sendToAiHint")}
					disabled={count === 0 || sending}
					onClick={sendToAi}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-foreground transition-colors hover:bg-accent/70 disabled:opacity-40"
				>
					<span className={`h-4 w-4 ${sending ? "animate-spin icon-[mdi--loading]" : "icon-[mdi--send]"}`} />
				</button>
				<button
					type="button"
					title={t("panel.sharinganHint")}
					onClick={toggleSharingan}
					className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
						sharingan
							? "bg-primary text-primary-foreground hover:opacity-90"
							: "bg-accent text-foreground hover:bg-accent/70"
					}`}
				>
					<span className={`h-4 w-4 ${sharingan ? "icon-[mdi--eye]" : "icon-[mdi--eye-off-outline]"}`} />
				</button>
				<button
					type="button"
					title={t("panel.settingsHint")}
					onClick={() => setSettingsOpen(true)}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
				>
					<span className="h-4 w-4 icon-[mdi--cog-outline]" />
				</button>
			</div>

			{/* 选择提示条 */}
			{selecting && (
				<div className="pointer-events-none absolute left-1/2 top-9 z-10 -translate-x-1/2 rounded-md bg-background/90 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
					{t("panel.selectingHint")}（{count}）
				</div>
			)}

			{/* webview */}
			<div className="relative flex min-h-0 flex-1">
				<webview
					ref={webviewRef}
					src="about:blank"
					partition={BROWSER_PARTITION}
					allowpopups={true}
					className="h-full w-full"
				/>
				{!currentUrl && !failed && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-6 text-center">
						<span className="h-8 w-8 text-muted-foreground/30 icon-[mdi--web]" />
						<span className="text-[12px] text-muted-foreground/60">{t("panel.empty")}</span>
					</div>
				)}
				{loading && (
					<div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
						<span className="h-3.5 w-3.5 animate-spin icon-[mdi--loading]" />
						{t("panel.loading")}
					</div>
				)}
				{failed && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center">
						<span className="h-8 w-8 text-muted-foreground/40 icon-[mdi--alert-circle-outline]" />
						<span className="text-[12px] text-muted-foreground/70">{t("panel.failed")}</span>
						<button
							type="button"
							onClick={() => {
								setFailed(false);
								webviewRef.current?.reload();
							}}
							className="rounded-md bg-accent px-3 py-1 text-[12px] text-foreground"
						>
							{t("panel.retry")}
						</button>
					</div>
				)}
			</div>

			{/* 轻提示 */}
			{toast && (
				<div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md bg-background/95 px-3 py-1.5 text-[12px] text-foreground shadow-md">
					{toast}
				</div>
			)}

			{/* 设置弹层 */}
			{settingsOpen && (
				<div
					className="absolute inset-0 z-30 flex items-center justify-center bg-background/60"
					onClick={() => setSettingsOpen(false)}
				>
					<div
						className="w-[320px] rounded-xl border border-border bg-background p-4 shadow-xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between">
							<span className="text-[13px] font-semibold">{t("panel.settings")}</span>
							<button
								type="button"
								aria-label={t("panel.settingsClose")}
								onClick={() => setSettingsOpen(false)}
								className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<span className="h-3.5 w-3.5 icon-[mdi--close]" />
							</button>
						</div>
						<div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2">
							<span className="text-[12px] text-muted-foreground">{t("panel.language")}</span>
							<span className="text-[12px] font-medium">{t("panel.languageValue")}</span>
						</div>
						<div className="mt-2 flex items-start justify-between gap-3 rounded-md bg-muted/60 px-3 py-2">
							<div className="min-w-0">
								<p className="text-[12px] font-medium">{t("panel.sharingan")}</p>
								<p className="mt-0.5 text-[11px] text-muted-foreground">{t("panel.sharinganDesc")}</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={sharingan}
								onClick={toggleSharingan}
								className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${sharingan ? "bg-primary" : "bg-muted"}`}
							>
								<span
									className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${sharingan ? "translate-x-[18px]" : "translate-x-0.5"}`}
								/>
							</button>
						</div>
						<p className="mt-3 text-[12px] font-semibold">{t("panel.kbdSection")}</p>
						<p className="text-[11px] text-muted-foreground">{t("panel.kbdHint")}</p>
						<div className="mt-1.5 space-y-0.5">
							{[
								{ key: "F2", label: t("panel.kbdPause") },
								{ key: "⌘C", label: t("panel.kbdCopy") },
								{ key: "⌘⇧C", label: t("panel.kbdText") },
								{ key: "⌘⇧I", label: t("panel.kbdImage") },
								{ key: "⌘M", label: t("panel.kbdMd") },
								{ key: "⌘Z", label: t("panel.kbdUndo") },
								{ key: "Esc", label: t("panel.kbdClear") },
								{ key: "Click", label: t("panel.kbdSelect") },
							].map((item) => (
								<div
									key={item.key}
									className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50"
								>
									<span className="text-[11px] text-muted-foreground">{item.label}</span>
									<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
										{item.key}
									</kbd>
								</div>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
