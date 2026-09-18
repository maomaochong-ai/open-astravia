import { createHash } from "node:crypto";
import { parsePluginManifest } from "@vetta-org/plugin-sdk/manifest";
import AdmZip from "adm-zip";
import type { MarketplacePluginRelease } from "./marketplace-schema.js";

const MAX_PLUGIN_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 120_000;

function assertArtifactUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== "https:" || url.username || url.password || url.hash) {
		throw new Error("Marketplace plugin artifact must use HTTPS without credentials or fragment");
	}
	return url;
}

function githubAssetAuthorization(url: URL, repository: string, accessToken?: string): string | undefined {
	if (!accessToken || url.hostname !== "api.github.com") return undefined;
	const source = new URL(repository);
	if (source.hostname !== "github.com") return undefined;
	const coordinates = source.pathname.replace(/\/$/, "").split("/").filter(Boolean);
	const path = url.pathname.split("/").filter(Boolean);
	if (
		coordinates.length !== 2 ||
		path.length !== 6 ||
		path[0] !== "repos" ||
		path[1] !== coordinates[0] ||
		path[2] !== coordinates[1] ||
		path[3] !== "releases" ||
		path[4] !== "assets" ||
		!/^[0-9]+$/.test(path[5] ?? "")
	) {
		return undefined;
	}
	return `Bearer ${accessToken}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	const sortedRight = [...right].sort();
	return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index]);
}

export async function fetchVerifiedMarketplacePluginArtifact(
	release: MarketplacePluginRelease,
	pluginId: string,
	repository: string,
	accessToken?: string,
	fetcher: typeof fetch = fetch,
): Promise<Buffer> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
	try {
		let url = assertArtifactUrl(release.artifact.url);
		let response: Response | undefined;
		for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
			const authorization = githubAssetAuthorization(url, repository, accessToken);
			response = await fetcher(url, {
				signal: controller.signal,
				redirect: "manual",
				headers: {
					Accept: "application/octet-stream",
					"User-Agent": "Vetta-Desktop",
					...(authorization ? { Authorization: authorization } : {}),
				},
			});
			if (![301, 302, 303, 307, 308].includes(response.status)) break;
			const location = response.headers.get("location");
			if (!location || redirect === MAX_REDIRECTS)
				throw new Error("Marketplace plugin artifact redirected too many times");
			url = assertArtifactUrl(new URL(location, url).toString());
		}
		if (!response?.ok || !response.body) {
			throw new Error(`Marketplace plugin artifact download failed: ${response?.status ?? "no response"}`);
		}
		const contentLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > MAX_PLUGIN_ARCHIVE_BYTES) {
			throw new Error("Marketplace plugin artifact exceeds size limit");
		}
		const chunks: Uint8Array[] = [];
		let total = 0;
		const reader = response.body.getReader();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				total += value.byteLength;
				if (total > MAX_PLUGIN_ARCHIVE_BYTES) throw new Error("Marketplace plugin artifact exceeds size limit");
				chunks.push(value);
			}
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
		const buffer = Buffer.concat(chunks, total);
		if (createHash("sha256").update(buffer).digest("hex") !== release.artifact.sha256) {
			throw new Error("Marketplace plugin artifact SHA-256 mismatch");
		}
		const zip = new AdmZip(buffer);
		const entry = zip.getEntry("plugin.json");
		if (!entry || entry.isDirectory) throw new Error("Marketplace plugin artifact has no root plugin.json");
		const manifest = parsePluginManifest(JSON.parse(zip.readAsText(entry)) as unknown);
		if (manifest.id !== pluginId || manifest.version !== release.version) {
			throw new Error("Marketplace plugin artifact identity does not match its release");
		}
		if (
			manifest.pluginApiVersion !== release.pluginApiVersion ||
			!sameStrings(manifest.permissions ?? [], release.permissions) ||
			!sameStrings(manifest.commands ?? [], release.commands)
		) {
			throw new Error("Marketplace plugin artifact contract does not match its release");
		}
		return buffer;
	} finally {
		clearTimeout(timeout);
	}
}
