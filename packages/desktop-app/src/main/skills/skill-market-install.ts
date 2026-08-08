/**
 * 从 Vetta 能力市场按 slug 下载并安装 skill/scene。
 * 市场下载可匿名；有登录 token 时附带 Authorization。
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { recordAbilityInstall } from "../abilities/ability-ledger.js";
import { DEFAULT_SERVER_URL } from "../constants.js";
import { readSettings, tryRefreshAccessToken } from "../ipc/settings.js";
import { getAppLogger } from "../logger.js";
import { verifySha256 } from "../utils/integrity.js";
import {
	ensureDirWritable,
	getSkillBaseDir,
	type InstalledSkillType,
	readSkillsManifest,
	recordSkillResourceEvent,
	writeSkillsManifest,
} from "./skill-service.js";

const log = getAppLogger("skill-market-install");
const tmpBaseDir = join(getVettaHomePath(), "tmp");

export interface MarketAbilityInfo {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	sha256?: string;
	type?: string;
}

export interface InstallSkillFromMarketResult {
	name: string;
	type: InstalledSkillType;
	version: string;
	updated: boolean;
}

interface ApiEnvelope<T> {
	code?: number;
	message?: string;
	data?: T;
}

function baseUrl(): string {
	return DEFAULT_SERVER_URL.replace(/\/+$/, "");
}

function currentToken(): string | undefined {
	const token = readSettings().serverToken;
	return typeof token === "string" && token !== "" ? token : undefined;
}

async function fetchWithOptionalAuth(path: string, accept: string): Promise<Response> {
	const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
	const doFetch = async (token?: string): Promise<Response> => {
		const headers: Record<string, string> = { Accept: accept };
		if (token) headers.Authorization = `Bearer ${token}`;
		return fetch(url, { headers });
	};

	let token = currentToken();
	let response = await doFetch(token);
	if (response.status === 401 && token) {
		const outcome = await tryRefreshAccessToken();
		if (outcome.status === "ok") {
			token = outcome.accessToken;
			response = await doFetch(token);
		}
	}
	return response;
}

function parseVersionFromSkillDir(skillDir: string): string {
	const skillMdPath = join(skillDir, "SKILL.md");
	if (!existsSync(skillMdPath)) return "0.0.0";
	try {
		const content = readFileSync(skillMdPath, "utf-8");
		const versionMatch = content.match(/version:\s*["']?([^\s"']+)["']?/i);
		return versionMatch?.[1] ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

export async function fetchMarketAbilityInfo(type: InstalledSkillType, slug: string): Promise<MarketAbilityInfo> {
	const response = await fetchWithOptionalAuth(
		`/abilities/${encodeURIComponent(type)}/${encodeURIComponent(slug)}/info`,
		"application/json",
	);
	if (!response.ok) {
		throw new Error(`Failed to fetch ability info (${response.status}) for ${type}/${slug}`);
	}
	const body = (await response.json()) as ApiEnvelope<MarketAbilityInfo>;
	if (body.code !== 0 || !body.data) {
		throw new Error(body.message || `Ability not found: ${type}/${slug}`);
	}
	return body.data;
}

export async function downloadMarketAbilityArchive(type: InstalledSkillType, slug: string): Promise<Buffer> {
	const response = await fetchWithOptionalAuth(
		`/abilities/${encodeURIComponent(type)}/${encodeURIComponent(slug)}/download`,
		"application/octet-stream",
	);
	if (!response.ok) {
		throw new Error(`Failed to download ability (${response.status}) for ${type}/${slug}`);
	}
	const arrayBuffer = await response.arrayBuffer();
	return Buffer.from(arrayBuffer);
}

export async function installSkillFromMarketArchive(
	name: string,
	type: InstalledSkillType,
	buffer: Buffer,
	meta: { alias?: string; marketDescription?: string; version?: string; sha256?: string } = {},
): Promise<InstallSkillFromMarketResult> {
	verifySha256(buffer, meta.sha256, `能力 ${name}`);

	const baseDir = getSkillBaseDir(type);
	if (!existsSync(baseDir)) {
		await mkdir(baseDir, { recursive: true });
	}
	ensureDirWritable(baseDir);

	const skillDir = join(baseDir, name);
	if (!existsSync(skillDir)) {
		await mkdir(skillDir, { recursive: true });
	}
	ensureDirWritable(skillDir);

	await mkdir(tmpBaseDir, { recursive: true });
	const tmpFile = join(tmpBaseDir, `_install_${name}_${Date.now()}.tar.gz`);
	try {
		await writeFile(tmpFile, buffer);
		execSync(`tar -xzf "${tmpFile}" -C "${skillDir}"`, { timeout: 30000 });
	} finally {
		try {
			await rm(tmpFile, { force: true });
		} catch {
			// ignore cleanup errors
		}
	}

	const version =
		typeof meta.version === "string" && meta.version.trim().length > 0
			? meta.version.trim()
			: parseVersionFromSkillDir(skillDir);

	const manifest = readSkillsManifest();
	const previous = manifest[name];
	manifest[name] = {
		name,
		version,
		installedAt: new Date().toISOString(),
		source: "market",
		enabled: true,
		type,
		alias: meta.alias,
		marketDescription: meta.marketDescription,
	};
	writeSkillsManifest(manifest);
	recordAbilityInstall(type, name, version);
	recordSkillResourceEvent({
		name,
		type,
		source: "market",
		operation: previous ? "updated" : "installed",
	});

	return { name, type, version, updated: Boolean(previous) };
}

/** 按市场 slug 拉 info + 归档并安装 skill/scene 能力。 */
export async function installSkillFromMarketSlug(
	type: InstalledSkillType,
	slug: string,
): Promise<InstallSkillFromMarketResult> {
	const trimmed = slug.trim();
	if (!trimmed) throw new Error("slug is required");
	if (type !== "skill" && type !== "scene") throw new Error(`Unsupported ability type: ${type}`);

	log.info("install from market", { type, slug: trimmed });
	const info = await fetchMarketAbilityInfo(type, trimmed);
	const archive = await downloadMarketAbilityArchive(type, trimmed);
	const name = (info.slug || trimmed).trim() || trimmed;
	return installSkillFromMarketArchive(name, type, archive, {
		alias: info.name,
		marketDescription: info.description,
		version: info.version,
		sha256: info.sha256,
	});
}
