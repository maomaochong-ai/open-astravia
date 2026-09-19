import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_APP_REPOSITORY = "openvetta/open-vetta";
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function parseVersion(value) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) throw new Error(`Invalid version: ${value}`);
	return match.slice(1).map(Number);
}

function compatibleApi(host, range) {
	if (!/^\^\d+\.\d+\.\d+$/.test(range)) throw new Error(`Invalid Plugin API range: ${range}`);
	const actual = parseVersion(host);
	const required = parseVersion(range.slice(1));
	return actual[0] === required[0] &&
		(actual[1] > required[1] || (actual[1] === required[1] && actual[2] >= required[2]));
}

function headers(token) {
	return { Accept: "application/vnd.github+json", "User-Agent": "Vetta-Marketplace-Release-Check", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function publishedSource(fetcher, repository, tag, path, token) {
	const response = await fetcher(`https://api.github.com/repos/${repository}/contents/${path}?ref=${tag}`, { headers: headers(token) });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Cannot read Desktop ${tag} source ${path}: ${response.status}`);
	const content = await response.json();
	if (content.encoding !== "base64" || typeof content.content !== "string") throw new Error(`Invalid Desktop ${tag} source response: ${path}`);
	return Buffer.from(content.content, "base64").toString("utf8");
}

async function sourceHostCapabilities(fetcher, repository, ref, label, token) {
	for (const path of [
		"apps/desktop/src/main/plugins/plugin-api-version.ts",
		"apps/desktop/src/main/plugins/plugin-catalog.ts",
	]) {
		const source = await publishedSource(fetcher, repository, ref, path, token);
		if (source === null) continue;
		const version = /PLUGIN_API_VERSION\s*=\s*"(\d+\.\d+\.\d+)"/.exec(source)?.[1];
		if (!version) throw new Error(`Desktop ${label} does not declare PLUGIN_API_VERSION in ${path}`);
		const schemaPath = "apps/desktop/src/main/abilities/open-marketplace/marketplace-schema.ts";
		const schema = await publishedSource(fetcher, repository, ref, schemaPath, token);
		const schemaVersion = /export const MARKETPLACE_SCHEMA_VERSION\s*=\s*(\d+)\s*;/.exec(schema ?? "")?.[1];
		if (!schemaVersion || Number(schemaVersion) < 3 || !schema?.includes("z.literal(MARKETPLACE_SCHEMA_VERSION)")) {
			throw new Error(`Desktop ${label} does not support marketplace schema v3`);
		}
		return version;
	}
	throw new Error(`Cannot find the Plugin API version in Desktop ${label}`);
}

async function candidateHostCapabilities(fetcher, repository, appVersion, commit, token) {
	if (!/^[a-f0-9]{40}$/.test(commit)) {
		throw new Error(`Desktop ${appVersion} candidate must be pinned to a full commit`);
	}
	const packagePath = "apps/desktop/package.json";
	const packageSource = await publishedSource(fetcher, repository, commit, packagePath, token);
	if (packageSource === null) throw new Error(`Cannot read Desktop candidate ${commit} source ${packagePath}`);
	let packageJson;
	try {
		packageJson = JSON.parse(packageSource);
	} catch {
		throw new Error(`Desktop candidate ${commit} has invalid ${packagePath}`);
	}
	if (packageJson.version !== appVersion) {
		throw new Error(`Desktop candidate ${commit} declares version ${JSON.stringify(packageJson.version)}, expected ${appVersion}`);
	}
	return sourceHostCapabilities(fetcher, repository, commit, `${appVersion} candidate ${commit}`, token);
}

async function publishedHostCapabilities(fetcher, repository, appVersion, token, candidateCommit) {
	const tag = `v${appVersion}`;
	const releaseUrl = `https://api.github.com/repos/${repository}/releases/tags/${tag}`;
	const response = await fetcher(releaseUrl, { headers: headers(token) });
	if (response.status === 404 && candidateCommit) {
		return candidateHostCapabilities(fetcher, repository, appVersion, candidateCommit, token);
	}
	if (!response.ok) throw new Error(`GitHub release check failed (${response.status}): ${releaseUrl}`);
	const release = await response.json();
	if (release.tag_name !== tag || release.draft || release.prerelease || !release.published_at || !Array.isArray(release.assets) || release.assets.length === 0) {
		throw new Error(`Desktop ${tag} is not a completed stable GitHub release`);
	}
	return sourceHostCapabilities(fetcher, repository, tag, tag, token);
}

function artifactAuthorization(url, repository, token) {
	if (!token || url.hostname !== "api.github.com") return undefined;
	const source = new URL(repository);
	if (source.hostname !== "github.com") return undefined;
	const coordinates = source.pathname.replace(/\/$/, "").split("/").filter(Boolean);
	const path = url.pathname.split("/").filter(Boolean);
	return coordinates.length === 2 && path.length === 6 && path[0] === "repos" &&
		path[1] === coordinates[0] && path[2] === coordinates[1] && path[3] === "releases" &&
		path[4] === "assets" && /^[0-9]+$/.test(path[5] ?? "") ? `Bearer ${token}` : undefined;
}

async function verifyArtifact(fetcher, artifact, repository, token) {
	let url = new URL(artifact.url);
	let response;
	for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
		if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`Unsafe artifact URL: ${url}`);
		const authorization = artifactAuthorization(url, repository, token);
		response = await fetcher(url, {
			redirect: "manual",
			headers: {
				"User-Agent": "Vetta-Marketplace-Release-Check",
				Accept: "application/octet-stream",
				...(authorization ? { Authorization: authorization } : {}),
			},
		});
		if (![301, 302, 303, 307, 308].includes(response.status)) break;
		const location = response.headers.get("location");
		if (!location || redirect === MAX_REDIRECTS) throw new Error(`Too many artifact redirects: ${artifact.url}`);
		url = new URL(location, url);
	}
	if (!response?.ok || !response.body) throw new Error(`Plugin artifact is unavailable: ${artifact.url} (${response?.status})`);
	const reader = response.body.getReader();
	const hash = createHash("sha256");
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_ARTIFACT_BYTES) throw new Error(`Plugin artifact exceeds size limit: ${artifact.url}`);
			hash.update(value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	if (hash.digest("hex") !== artifact.sha256) throw new Error(`Plugin artifact SHA-256 mismatch: ${artifact.url}`);
}

/** Fail closed before a schema v3 catalog is promoted to a stable marketplace ref. */
export async function verifyMarketplacePublication(manifest, {
	fetcher = fetch,
	appRepository = DEFAULT_APP_REPOSITORY,
	token,
	candidateAppCommits = {},
} = {}) {
	if (manifest.schemaVersion !== 3) throw new Error("Publication check requires marketplace schemaVersion 3");
	if (candidateAppCommits === null || typeof candidateAppCommits !== "object" || Array.isArray(candidateAppCommits)) {
		throw new Error("candidateAppCommits must map App versions to full commits");
	}
	const releases = manifest.abilities.flatMap((ability) => {
		if (ability.type === "plugin") {
			if (!Array.isArray(ability.releases) || ability.releases.length === 0) {
				throw new Error(`Plugin ${ability.slug} has no versioned releases`);
			}
			return ability.releases.map((release) => ({ slug: ability.slug, release }));
		}
		if (ability.type !== "bundle") return [];
		return ability.config.members.flatMap((member) => {
			if (member.type !== "plugin" || !member.source) return [];
			if (!Array.isArray(member.releases) || member.releases.length === 0) {
				throw new Error(`Plugin ${member.slug} has no versioned releases`);
			}
			return member.releases.map((release) => ({ slug: member.slug, release }));
		});
	});
	const hostVersions = new Map();
	for (const { slug, release } of releases) {
		if (!hostVersions.has(release.minAppVersion)) {
			hostVersions.set(release.minAppVersion, await publishedHostCapabilities(
				fetcher,
				appRepository,
				release.minAppVersion,
				token,
				candidateAppCommits[release.minAppVersion],
			));
		}
		if (!compatibleApi(hostVersions.get(release.minAppVersion), release.pluginApiVersion)) {
			throw new Error(`${slug}@${release.version} requires Plugin API ${release.pluginApiVersion}, unavailable in published Desktop ${release.minAppVersion}`);
		}
		await verifyArtifact(fetcher, release.artifact, manifest.repository, token);
	}
	return { releases: releases.length, appVersions: [...hostVersions.keys()] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const [manifestPath, appRepository = DEFAULT_APP_REPOSITORY] = process.argv.slice(2);
	if (!manifestPath) {
		process.stderr.write("Usage: node check-plugin-marketplace-publication.mjs <marketplace.json> [owner/repository]\n");
		process.exitCode = 2;
	} else {
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			const result = await verifyMarketplacePublication(manifest, { appRepository, token: process.env.GITHUB_TOKEN });
			process.stdout.write(`Verified ${result.releases} plugin releases against ${result.appVersions.length} published Desktop versions.\n`);
		} catch (error) {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		}
	}
}
