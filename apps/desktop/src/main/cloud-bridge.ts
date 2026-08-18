/**
 * 宿主侧云服务挂载点（主进程）。
 *
 * cloud 模块启动时经 `setCloudBridge()` 注入实现；lite 构建
 * （VETTA_CLOUD_ENABLED=false）不加载 cloud 模块，bridge 恒为 null，
 * 宿主功能按「无云端」优雅降级。宿主代码只准 import 本文件，
 * 不得直接 import `cloud/` 内部实现。
 *
 * 类型定义放在宿主侧，供宿主消费方与 cloud 实现共同引用。
 */

export interface RemoteProvidersResult {
	providers: Record<string, unknown>;
	error?: string;
}

export interface VettaGatewayRequest {
	path: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
	timeoutMs?: number;
}

export interface VettaGatewayResponse<T = unknown> {
	ok: boolean;
	status: number;
	code: number;
	message: string;
	data?: T;
}

/** refresh 的三态结果，与 preload 合同保持一致（见 preload/api-types/auth.ts）。 */
export type CloudRefreshOutcome =
	| { status: "ok"; accessToken: string }
	| { status: "unauthorized" }
	| { status: "transient" };

export interface CloudBridge {
	/** 云端 provider 目录（Vetta Go 等远程模型）。 */
	fetchRemoteProviders(): Promise<RemoteProvidersResult>;
	/** 经 vetta 服务端 `/api/v1` 的带鉴权中转（图像生成等增值能力）。 */
	requestGateway<T = unknown>(request: VettaGatewayRequest, signal?: AbortSignal): Promise<VettaGatewayResponse<T>>;
	/** 主进程内部 token refresh（单飞）。 */
	tryRefreshAccessToken(): Promise<CloudRefreshOutcome>;
}

let bridge: CloudBridge | null = null;

export function setCloudBridge(next: CloudBridge | null): void {
	bridge = next;
}

/** lite 构建（或 cloud 尚未初始化）返回 null；调用方必须自带降级路径。 */
export function getCloudBridge(): CloudBridge | null {
	return bridge;
}

/** 云服务不可用时的统一网关失败回执（envelope 形状，调用方按 !ok 处理）。 */
export function gatewayUnavailableResponse<T = unknown>(): VettaGatewayResponse<T> {
	return { ok: false, status: 0, code: -1, message: "Vetta cloud services are not available in this build" };
}
