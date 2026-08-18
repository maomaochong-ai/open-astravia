import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { net } from "electron";
import { fetchRemoteProviders } from "../ipc/settings.js";

/**
 * Probe the given (provider, model)'s baseUrl to see if the model server is
 * reachable. Returns ok=true on any HTTP response (including 4xx/5xx — the
 * host answered, auth/path issues are a separate concern), ok=false on
 * network / DNS / TLS failures.
 *
 * Resolves the provider from local models.json first (LAN servers like
 * Ollama / vLLM), then falls back to the auth-server's remote provider
 * catalogue (Vetta Go et al.). Re-fetches remote on demand instead of
 * trusting the renderer's atom, which may be stale.
 *
 * Uses electron.net.fetch deliberately so we go through Chromium's network
 * stack and bypass macOS 15 LNP, same as the GUI session.
 *
 * Shared by the IM bridge model probe and the knowledge-base model probe.
 */
export async function probeModelProvider(ref: {
	provider: string;
	model: string;
}): Promise<{ ok: boolean; message?: string; error?: string }> {
	// 1) Local models.json first.
	let provider: { baseUrl?: string } | undefined;
	try {
		const raw = await readFile(join(getVettaHomePath(), "agent", "models.json"), "utf8");
		const parsed = JSON.parse(raw) as {
			providers?: Record<string, { baseUrl?: string }>;
		};
		provider = parsed.providers?.[ref.provider];
	} catch {
		// File missing/unreadable is fine — fall through to remote.
	}

	// 2) Fall back to remote provider catalogue.
	let source: "local" | "remote" = "local";
	if (!provider) {
		const remote = await fetchRemoteProviders();
		const r = remote.providers[ref.provider] as { baseUrl?: string } | undefined;
		if (r) {
			provider = r;
			source = "remote";
		} else if (remote.error && Object.keys(remote.providers).length === 0) {
			return {
				ok: false,
				error: `provider "${ref.provider}" 既不在本地 models.json 也无法查询云端 provider 列表（${remote.error}）`,
			};
		}
	}

	if (!provider) {
		return {
			ok: false,
			error: `provider "${ref.provider}" 既不在本地 models.json 也不在云端 provider 列表`,
		};
	}
	if (!provider.baseUrl) {
		return { ok: false, error: `provider "${ref.provider}" 缺 baseUrl` };
	}

	// Reachability check only — hit the bare origin and treat any HTTP
	// response as "host reachable". Only network / DNS / TLS failures fail.
	let origin: string;
	try {
		const u = new URL(provider.baseUrl);
		origin = `${u.protocol}//${u.host}`;
	} catch {
		return { ok: false, error: `provider "${ref.provider}" 的 baseUrl 解析失败：${provider.baseUrl}` };
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5_000);
	try {
		await net.fetch(origin, { method: "GET", signal: controller.signal });
		return {
			ok: true,
			message: `provider 可达（${source === "remote" ? "云端" : "本地"}）`,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		const sanitized = msg
			.replace(/https?:\/\/[^\s]+/gi, "目标地址")
			.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "目标地址");
		return { ok: false, error: `provider 不可达：${sanitized}` };
	} finally {
		clearTimeout(timer);
	}
}
