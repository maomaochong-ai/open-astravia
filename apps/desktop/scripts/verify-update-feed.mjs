import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { pathToFileURL } from "node:url";
import { resolveUpdatePublishConfig } from "./resolve-update-publish-config.mjs";

export const DESKTOP_UPDATE_METADATA_FILES = Object.freeze([
	"latest.yml",
	"latest-mac.yml",
	"latest-linux.yml",
]);

function requireReleaseVersion(version) {
	const value = version?.trim().replace(/^v/, "");
	if (!value || !/^\d+\.\d+\.\d+$/.test(value)) {
		throw new Error("[verify-update-feed] VETTA_DESKTOP_RELEASE_VERSION must be a semantic version");
	}
	return value;
}

export function resolveUpdateFeedBase({ env = process.env, version } = {}) {
	const releaseVersion = requireReleaseVersion(version);
	const config = resolveUpdatePublishConfig(env);
	if (config.provider === "generic") return `${config.url.replace(/\/+$/, "")}/`;
	return `https://github.com/${config.owner}/${config.repo}/releases/download/v${releaseVersion}/`;
}

function delay(milliseconds) {
	return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

async function requestWithRetry(
	url,
	init,
	{ fetchImpl = fetch, attempts = 4, retryDelayMs = 1000, timeoutMs = 15000, acceptedStatuses = [] } = {},
) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImpl(url, { ...init, signal: controller.signal });
			if (response.ok || acceptedStatuses.includes(response.status)) return response;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		} finally {
			clearTimeout(timeout);
		}
		if (attempt < attempts) await delay(retryDelayMs * attempt);
	}
	throw new Error(`[verify-update-feed] request failed: ${url} (${lastError?.message ?? "unknown error"})`);
}

async function requireResponse(url, init, options) {
	const response = await requestWithRetry(url, init, options);
	if (!response.ok) throw new Error(`[verify-update-feed] request failed: ${url} (HTTP ${response.status})`);
	return response;
}

function metadataReferences(document, metadataName) {
	if (!document || typeof document !== "object" || !Array.isArray(document.files)) {
		throw new Error(`[verify-update-feed] ${metadataName} has no files list`);
	}
	const references = new Set();
	if (typeof document.path === "string" && document.path.length > 0) references.add(document.path);
	for (const file of document.files) {
		if (!file || typeof file.url !== "string" || file.url.length === 0) {
			throw new Error(`[verify-update-feed] ${metadataName} contains an invalid artifact reference`);
		}
		references.add(file.url);
	}
	if (references.size === 0) throw new Error(`[verify-update-feed] ${metadataName} references no artifacts`);
	return [...references];
}

async function verifyArtifactAvailability(url, options) {
	let response = await requestWithRetry(url, { method: "HEAD" }, { ...options, acceptedStatuses: [405] });
	if (response.status === 405) {
		response = await requireResponse(url, { method: "GET", headers: { Range: "bytes=0-0" } }, options);
	}
	return response;
}

export async function verifyUpdateFeed({
	env = process.env,
	version,
	metadataFiles = DESKTOP_UPDATE_METADATA_FILES,
	fetchImpl = fetch,
	attempts = 4,
	retryDelayMs = 1000,
	timeoutMs = 15000,
} = {}) {
	const releaseVersion = requireReleaseVersion(version);
	const baseUrl = resolveUpdateFeedBase({ env, version: releaseVersion });
	const requestOptions = { fetchImpl, attempts, retryDelayMs, timeoutMs };
	const verifiedArtifacts = [];
	for (const metadataName of metadataFiles) {
		const metadataUrl = new URL(metadataName, baseUrl).toString();
		const metadataResponse = await requireResponse(metadataUrl, { method: "GET" }, requestOptions);
		let document;
		try {
			document = parse(await metadataResponse.text());
		} catch (error) {
			throw new Error(`[verify-update-feed] ${metadataName} is not valid YAML`, { cause: error });
		}
		if (document?.version !== releaseVersion) {
			throw new Error(
				`[verify-update-feed] ${metadataName} has version ${String(document?.version)}, expected ${releaseVersion}`,
			);
		}
		for (const reference of metadataReferences(document, metadataName)) {
			const artifactUrl = new URL(reference, metadataUrl).toString();
			await verifyArtifactAvailability(artifactUrl, requestOptions);
			verifiedArtifacts.push(artifactUrl);
		}
	}
	return {
		version: releaseVersion,
		baseUrl,
		metadataFiles: [...metadataFiles],
		artifacts: verifiedArtifacts,
	};
}

function isExecutedDirectly() {
	return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isExecutedDirectly()) {
	const localMetadataPath = join(import.meta.dirname, "../release/latest.yml");
	const resolveDirectVersion = async () => {
		const configured = process.env.VETTA_DESKTOP_RELEASE_VERSION?.trim();
		if (configured) return configured;
		try {
			const document = parse(await readFile(localMetadataPath, "utf8"));
			return document?.version;
		} catch (error) {
			throw new Error(
				"[verify-update-feed] set VETTA_DESKTOP_RELEASE_VERSION or provide release/latest.yml",
				{ cause: error },
			);
		}
	};
	resolveDirectVersion()
		.then((version) => verifyUpdateFeed({ version }))
		.then((result) => {
			console.log(
				`[verify-update-feed] ${result.version}: ${result.metadataFiles.length} metadata files and ${result.artifacts.length} artifacts are publicly reachable`,
			);
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		});
}
