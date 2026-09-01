import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, type Ref, useCallback, useEffect, useRef, useState } from "react";
import { buildEmbedCss } from "../runtime/embed-css.js";
import { readHostTheme } from "../runtime/host-theme.js";

/** Electron `<webview>` 运行时方法的最小接口（仅声明这里用到的）。 */
interface WebviewElement extends HTMLElement {
	loadURL(url: string): Promise<void>;
	getURL(): string;
	reload(): void;
	insertCSS(css: string): Promise<string>;
	removeInsertedCSS(key: string): Promise<void>;
}

/** webview 的持久分区：让 baguette 页面记住流格式等本地偏好。 */
const PARTITION = "persist:vetta-ios-simulator";

interface SimulatorWebviewProps {
	readonly url: string;
}

/**
 * 承载 baguette 控制台的 guest。
 *
 * 两个约束都是踩出来的，改动前请先读：
 *
 * 1. **必须是 webview，不能是 iframe**：serve 对每个响应下发
 *    `Content-Security-Policy: frame-ancestors 'none'`（`--allowed-hosts` 也不放开），
 *    iframe 会被浏览器直接拦掉，表现为一片白。webview 的 guest 是独立顶层浏览
 *    上下文，不受该指令约束。
 * 2. **`src` 必须是静态 `about:blank`，真实地址在 `dom-ready` 之后用 `loadURL` 加载**。
 *    直接把地址写进 `src` 时 guest 不会挂载起来（`dom-ready` 不触发），表现为一片黑。
 *    宿主自己的内置浏览器面板用的也是这个写法。
 */
export function SimulatorWebview({ url }: SimulatorWebviewProps): JSX.Element {
	const { t } = useTranslation();
	const hostRef = useRef<HTMLDivElement | null>(null);
	const webviewRef = useRef<WebviewElement | null>(null);
	const cssKeyRef = useRef<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	/** 重新注入嵌入样式。先移除上一份，避免主题来回切时叠加出一堆样式表。 */
	const applyEmbedCss = useCallback(async (): Promise<void> => {
		const element = webviewRef.current;
		if (!element) return;
		const css = buildEmbedCss(readHostTheme(hostRef.current));
		try {
			const previous = cssKeyRef.current;
			cssKeyRef.current = await element.insertCSS(css);
			if (previous) await element.removeInsertedCSS(previous).catch(() => undefined);
		} catch {
			// 注入失败只是回到 baguette 原本的外观，不影响功能。
		}
	}, []);

	useEffect(() => {
		const element = webviewRef.current;
		if (!element) return;

		const load = (): void => {
			if (element.getURL() === url) return;
			void element.loadURL(url).catch((error: unknown) => {
				setFailure(error instanceof Error ? error.message : String(error));
			});
		};
		const onReady = (): void => {
			setFailure(null);
			// 每次导航后 dom-ready 都会再触发，注入的样式随文档失效需要重新插入。
			cssKeyRef.current = null;
			void applyEmbedCss();
			load();
		};
		const onFail = (event: Event): void => {
			// errorCode -3 (ABORTED) 多因重定向或手动停止，不是真实失败。
			const detail = event as unknown as {
				errorCode: number;
				errorDescription: string;
				isMainFrame: boolean;
			};
			if (!detail.isMainFrame || detail.errorCode === -3) return;
			setFailure(`${detail.errorDescription} (${detail.errorCode})`);
		};

		element.addEventListener("dom-ready", onReady);
		element.addEventListener("did-fail-load", onFail);
		return () => {
			element.removeEventListener("dom-ready", onReady);
			element.removeEventListener("did-fail-load", onFail);
		};
	}, [applyEmbedCss, url]);

	// 宿主切换明暗时重新染色。宿主把模式写在 <html data-mode> 上。
	useEffect(() => {
		const observer = new MutationObserver(() => void applyEmbedCss());
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "class"] });
		return () => observer.disconnect();
	}, [applyEmbedCss]);

	return (
		<div ref={hostRef} className="relative min-h-0 flex-1">
			<webview
				ref={webviewRef as unknown as Ref<HTMLElement>}
				src="about:blank"
				partition={PARTITION}
				className="h-full w-full"
			/>
			{failure ? (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
					<p className="text-sm font-medium">{t("panel.loadFailed")}</p>
					<p className="text-xs leading-relaxed text-muted-foreground">{failure}</p>
					<button
						type="button"
						className="ios-sim-button"
						onClick={() => {
							setFailure(null);
							webviewRef.current?.reload();
						}}
					>
						{t("panel.retry")}
					</button>
				</div>
			) : null}
		</div>
	);
}
