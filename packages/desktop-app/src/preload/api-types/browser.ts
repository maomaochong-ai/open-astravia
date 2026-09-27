/**
 * 浏览器自动化 preload 层类型桥接。
 *
 * 领域类型（BrowserSession, BrowserAction 等）全部从 @astravia/capability-sdk 重新导出——
 * 能力定义的唯一真源是 capability-sdk 的 TypeBox schema。
 * DesktopBrowserApi 是 preload bridge 的合同——sessionId-first 参数形态，
 * 所有方法第一参数 sessionId = plugin capability session id。
 */
import type {
	BrowserAction,
	BrowserActionResult,
	BrowserPageState,
	BrowserReadTextInput,
	BrowserRuntimeStatus,
	BrowserScreenshot,
	BrowserScreenshotInput,
	BrowserSession,
	BrowserSessionCreateInput,
	BrowserSnapshot,
	BrowserSnapshotInput,
	BrowserTextContent,
} from "@astravia/capability-sdk";

export type {
	BrowserActInput,
	BrowserAction,
	BrowserActionResult,
	BrowserNavigateInput,
	BrowserPageState,
	BrowserReadTextInput,
	BrowserRuntimeInstallInput,
	BrowserRuntimePhase,
	BrowserRuntimeStatus,
	BrowserScreenshot,
	BrowserScreenshotInput,
	BrowserSession,
	BrowserSessionCreateInput,
	BrowserSessionInput,
	BrowserSessionProfile,
	BrowserSessionStatus,
	BrowserSnapshot,
	BrowserSnapshotInput,
	BrowserSource,
	BrowserTextContent,
} from "@astravia/capability-sdk";

/** preload bridge 安装时 step 枚举（兼容历史命名）。 */
export type BrowserRuntimeInstallStep = "runtime" | "browser";

export interface DesktopBrowserApi {
	runtimeStatus(sessionId: string): Promise<BrowserRuntimeStatus>;
	installRuntime(sessionId: string, step: BrowserRuntimeInstallStep): Promise<BrowserRuntimeStatus>;
	createSession(
		sessionId: string,
		options?: Partial<Omit<BrowserSessionCreateInput, "namespace">>,
	): Promise<BrowserSession>;
	getSession(sessionId: string, browserSessionId: string): Promise<BrowserSession>;
	navigate(sessionId: string, browserSessionId: string, url: string): Promise<BrowserPageState>;
	snapshot(
		sessionId: string,
		browserSessionId: string,
		options?: Partial<Omit<BrowserSnapshotInput, "namespace" | "sessionId">>,
	): Promise<BrowserSnapshot>;
	readText(
		sessionId: string,
		browserSessionId: string,
		options?: Partial<Omit<BrowserReadTextInput, "namespace" | "sessionId">>,
	): Promise<BrowserTextContent>;
	screenshot(
		sessionId: string,
		browserSessionId: string,
		options?: Partial<Omit<BrowserScreenshotInput, "namespace" | "sessionId">>,
	): Promise<BrowserScreenshot>;
	act(
		sessionId: string,
		browserSessionId: string,
		action: BrowserAction,
		options?: { snapshotRevision?: number },
	): Promise<BrowserActionResult>;
	closeSession(sessionId: string, browserSessionId: string): Promise<void>;
}
