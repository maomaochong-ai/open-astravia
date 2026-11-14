import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry, resolveRetryDecision } from "./fetch-with-retry";

function ok(): Response {
	return new Response("payload", { status: 200 });
}
function status(code: number): Response {
	return new Response(null, { status: code });
}

/**
 * 能力市场在国内网络下的两种真实故障：半开连接（一直没有字节）与瞬时 RST。
 * 这里钉的是「会重试」与「不该重试的别重试」两条边界。
 */
describe("下载重试决策", () => {
	it("5xx 与 429 值得重试，4xx 直接放弃", () => {
		expect(resolveRetryDecision({ attempt: 1, maxAttempts: 3, status: 503 }).retry).toBe(true);
		expect(resolveRetryDecision({ attempt: 1, maxAttempts: 3, status: 429 }).retry).toBe(true);
		expect(resolveRetryDecision({ attempt: 1, maxAttempts: 3, status: 404 }).retry).toBe(false);
		expect(resolveRetryDecision({ attempt: 1, maxAttempts: 3, status: 401 }).retry).toBe(false);
	});

	it("退避逐次翻倍并封顶", () => {
		expect(resolveRetryDecision({ attempt: 1, maxAttempts: 5, status: 503 }).delayMs).toBe(400);
		expect(resolveRetryDecision({ attempt: 2, maxAttempts: 5, status: 503 }).delayMs).toBe(800);
		expect(resolveRetryDecision({ attempt: 3, maxAttempts: 5, status: 503 }).delayMs).toBe(1600);
		expect(resolveRetryDecision({ attempt: 9, maxAttempts: 10, status: 503 }).delayMs).toBe(4000);
	});

	it("尝试次数用完就不再重试", () => {
		expect(resolveRetryDecision({ attempt: 3, maxAttempts: 3, status: 503 }).reason).toBe("attempts-exhausted");
	});
});

describe("带重试的请求", () => {
	it("首次失败后重试成功", async () => {
		const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(ok());
		const sleep = vi.fn(async () => {});
		const result = await fetchWithRetry("https://example.test/a.zip", {}, { fetchImpl, sleep });

		expect(result.attempts).toBe(2);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(400);
	});

	it("503 重试，404 不重试", async () => {
		const retryable = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok());
		await expect(
			fetchWithRetry("https://x.test/a", {}, { fetchImpl: retryable, sleep: async () => {} }),
		).resolves.toMatchObject({ attempts: 2 });

		const notFound = vi.fn().mockResolvedValue(status(404));
		const result = await fetchWithRetry("https://x.test/a", {}, { fetchImpl: notFound, sleep: async () => {} });
		expect(result.response.status).toBe(404);
		expect(notFound).toHaveBeenCalledTimes(1);
	});

	it("一直失败时抛出最后一次的真实错误，并把次数用完", async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
		await expect(
			fetchWithRetry("https://x.test/a", {}, { fetchImpl, sleep: async () => {}, maxAttempts: 3 }),
		).rejects.toThrow("ETIMEDOUT");
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it("用户取消后不再发后续请求", async () => {
		const controller = new AbortController();
		const fetchImpl = vi.fn().mockImplementation(async () => {
			controller.abort();
			throw new DOMException("aborted", "AbortError");
		});
		await expect(
			fetchWithRetry("https://x.test/a", {}, { fetchImpl, sleep: async () => {}, signal: controller.signal }),
		).rejects.toThrow();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
