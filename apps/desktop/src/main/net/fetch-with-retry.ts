/**
 * 带超时与重试的 HTTP 下载。
 *
 * 为什么需要：能力市场（插件归档、技能归档）此前用裸 `fetch()`。Node 的 fetch 来自
 * undici，默认 `headersTimeout` / `bodyTimeout` 都是 300 秒——国内网络访问境外 CDN
 * 常见的两种故障形态都落在这条默认值上：
 *
 * - **半开连接**：TCP 握手完成、之后没有任何字节回来。裸 fetch 会一直挂着，
 *   界面上是「正在安装…」持续几分钟，最后报一个没有信息量的网络错误。
 * - **瞬时 RST**：连接被中途重置，一次就失败，没有任何重试。
 *
 * 用户看到的「偶发网络错误、开 VPN 就正常」正是这两条。这里做三件事：
 * 每次尝试各自带超时、失败按退避重试、把「不可重试」的错误（4xx）直接抛出去。
 *
 * 刻意不做的事：不改请求地址、不引入第三方镜像、不改 TLS 校验。重试解决的是
 * 传输层抖动，不是把流量换个地方走。
 */
export interface FetchWithRetryOptions {
	/** 单次尝试的超时。归档下载比元数据慢，调用方可以分别给。 */
	readonly attemptTimeoutMs?: number;
	/** 总尝试次数（含首次）。 */
	readonly maxAttempts?: number;
	/** 第一次重试前的等待，之后逐次翻倍。 */
	readonly baseDelayMs?: number;
	/** 单次等待上限，避免退避到几十秒。 */
	readonly maxDelayMs?: number;
	/** 外部取消：用户关掉面板、切换到别的会话时应当立刻停止。 */
	readonly signal?: AbortSignal;
	/** 仅供测试注入。 */
	readonly fetchImpl?: typeof fetch;
	readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 400;
const DEFAULT_MAX_DELAY_MS = 4_000;

/** 这些状态码是「对端现在不行」，过一会儿再来可能就好了。 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface RetryDecision {
	readonly retry: boolean;
	readonly delayMs: number;
	readonly reason: string;
}

/** 判断一次失败该不该重试。抽成纯函数，测试不需要真的等。 */
export function resolveRetryDecision(params: {
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly status?: number;
	readonly error?: unknown;
	readonly baseDelayMs?: number;
	readonly maxDelayMs?: number;
}): RetryDecision {
	const baseDelayMs = params.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	const maxDelayMs = params.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const delayFor = (attempt: number): number => Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));

	if (params.attempt >= params.maxAttempts) {
		return { retry: false, delayMs: 0, reason: "attempts-exhausted" };
	}

	if (typeof params.status === "number") {
		if (RETRYABLE_STATUS.has(params.status)) {
			return { retry: true, delayMs: delayFor(params.attempt), reason: `status-${params.status}` };
		}
		// 404 / 401 / 403 这类重复请求也不会变好，重试只会让用户多等。
		return { retry: false, delayMs: 0, reason: `status-${params.status}-not-retryable` };
	}

	if (params.error !== undefined) {
		return { retry: true, delayMs: delayFor(params.attempt), reason: "transport-error" };
	}

	return { retry: false, delayMs: 0, reason: "unknown" };
}

export interface FetchWithRetryResult {
	readonly response: Response;
	/** 实际尝试次数，便于日志里看出是首次成功还是重试成功。 */
	readonly attempts: number;
}

/**
 * 发起请求；失败按 {@link resolveRetryDecision} 重试。
 *
 * 返回值只有「成功拿到 Response」或「抛出最后一次失败」两种。注意：HTTP 状态码本身
 * 不在这里判定成功与否——调用方仍要自己看 `response.ok`（4xx 会原样返回）。
 */
export async function fetchWithRetry(
	url: string,
	init: RequestInit,
	options: FetchWithRetryOptions = {},
): Promise<FetchWithRetryResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		if (options.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

		// 每次尝试一个独立超时：整个下载共用一个超时会让「慢但在动」的连接被误杀。
		const timeoutSignal = AbortSignal.timeout(attemptTimeoutMs);
		const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

		try {
			const response = await fetchImpl(url, { ...init, signal });
			if (response.ok) return { response, attempts: attempt };
			// 4xx/5xx：交给决策函数判断要不要重试。注意 5xx 的响应体要丢弃，避免连接挂着。
			const decision = resolveRetryDecision({
				attempt,
				maxAttempts,
				status: response.status,
				baseDelayMs: options.baseDelayMs,
				maxDelayMs: options.maxDelayMs,
			});
			if (!decision.retry) return { response, attempts: attempt };
			void response.body?.cancel().catch(() => {});
			await sleep(decision.delayMs);
		} catch (error) {
			lastError = error;
			// 用户主动取消：立刻停，不再重试。
			if (options.signal?.aborted) throw error;
			// 超时（AbortError/TimeoutError）也带 error 进决策：它是「还没死但没回话」，
			// 值得再来一次；用户主动取消在上面已经提前 return 了。
			const decision = resolveRetryDecision({
				attempt,
				maxAttempts,
				error,
				baseDelayMs: options.baseDelayMs,
				maxDelayMs: options.maxDelayMs,
			});
			if (!decision.retry) throw error;
			await sleep(decision.delayMs);
		}
	}
	throw lastError instanceof Error ? lastError : new Error("Request failed");
}
