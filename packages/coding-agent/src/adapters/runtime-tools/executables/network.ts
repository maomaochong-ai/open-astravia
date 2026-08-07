import { writeFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { APP_NAME } from "../../../config.js";

const NETWORK_TIMEOUT_MS = 30_000;
const NETWORK_RETRY_COUNT = 2;
const NETWORK_RETRY_DELAY_MS = 1_000;
const GitHubReleaseSchema = Type.Object({ tag_name: Type.String() }, { additionalProperties: true });

export interface CodingToolHttpResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly json: () => Promise<unknown>;
	readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export type CodingToolHttpRequest = (url: string, init?: RequestInit) => Promise<CodingToolHttpResponse>;

export function parseLatestReleaseVersion(payload: unknown): string {
	if (!Value.Check(GitHubReleaseSchema, payload)) {
		throw new Error("GitHub API response missing tag_name");
	}
	return payload.tag_name.replace(/^v/, "");
}

export async function fetchLatestCodingToolVersion(
	repository: string,
	request: CodingToolHttpRequest = fetch,
): Promise<string> {
	const response = await request(`https://api.github.com/repos/${repository}/releases/latest`, {
		headers: { "User-Agent": `${APP_NAME}-coding-agent` },
		signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
	});

	if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
	return parseLatestReleaseVersion(await response.json());
}

export interface CodingToolDownloadRetryOptions {
	readonly retryCount?: number;
	readonly retryDelayMs?: number;
	readonly timeoutMs?: number;
}

export async function downloadCodingToolArchiveWithRetry(
	url: string,
	destination: string,
	request: CodingToolHttpRequest = fetch,
	options: CodingToolDownloadRetryOptions = {},
): Promise<void> {
	const retryCount = options.retryCount ?? NETWORK_RETRY_COUNT;
	const retryDelayMs = options.retryDelayMs ?? NETWORK_RETRY_DELAY_MS;
	const timeoutMs = options.timeoutMs ?? NETWORK_TIMEOUT_MS;

	for (let attempt = 0; attempt <= retryCount; attempt += 1) {
		try {
			const response = await request(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
			await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
			return;
		} catch (error) {
			if (attempt >= retryCount || !isRetryableDownloadError(error)) throw error;
			await wait(retryDelayMs * (attempt + 1));
		}
	}
}

function isRetryableDownloadError(error: unknown): boolean {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "TypeError");
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
