import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";

/**
 * Detect and import legacy im-gateway configuration written by older
 * versions of the standalone CLI. The new desktop-app embeds im-gateway
 * as a sidecar and stores everything under ~/.vetta/desktop-app/, so
 * we walk the legacy paths once on first launch and surface them to the
 * UI as a one-shot import wizard.
 *
 * Legacy paths:
 *   ~/.vetta/im-gateway/config.yaml         (transport selection, paths)
 *   ~/.vetta/im-gateway/credentials.yaml    (feishu app id / secret)
 *   ~/.vetta/im-gateway/state.json          (routing table)
 *   ~/.vetta/desktop-config.json (.imGateway field — historical)
 *
 * After successful import the yaml files are renamed with .bak suffix
 * so the prompt does not re-fire.
 */

const LEGACY_DIR = join(getVettaHomePath(), "im-gateway");
const LEGACY_CONFIG = join(LEGACY_DIR, "config.yaml");
const LEGACY_CREDENTIALS = join(LEGACY_DIR, "credentials.yaml");
const LEGACY_STATE = join(LEGACY_DIR, "state.json");

export interface LegacyDetection {
	hasLegacyData: boolean;
	configPath?: string;
	credentialsPath?: string;
	statePath?: string;
	parsed?: LegacyParsed;
	error?: string;
}

export interface LegacyParsed {
	feishu?: {
		appId?: string;
		appSecret?: string;
		baseUrl?: string;
	};
	stateEntries?: Array<{
		userId: string;
		projectId: string;
		sessionPath: string;
		updatedAt?: string;
	}>;
}

export function detectLegacyImGateway(): LegacyDetection {
	const hasConfig = existsSync(LEGACY_CONFIG);
	const hasCreds = existsSync(LEGACY_CREDENTIALS);
	const hasState = existsSync(LEGACY_STATE);

	if (!hasConfig && !hasCreds && !hasState) {
		return { hasLegacyData: false };
	}

	const result: LegacyDetection = {
		hasLegacyData: true,
		configPath: hasConfig ? LEGACY_CONFIG : undefined,
		credentialsPath: hasCreds ? LEGACY_CREDENTIALS : undefined,
		statePath: hasState ? LEGACY_STATE : undefined,
	};

	try {
		result.parsed = parseLegacyFiles({
			config: hasConfig ? LEGACY_CONFIG : undefined,
			credentials: hasCreds ? LEGACY_CREDENTIALS : undefined,
			state: hasState ? LEGACY_STATE : undefined,
		});
	} catch (err) {
		result.error = (err as Error).message;
	}
	return result;
}

interface LegacyParseInputs {
	config?: string;
	credentials?: string;
	state?: string;
}

function parseLegacyFiles(inputs: LegacyParseInputs): LegacyParsed {
	const out: LegacyParsed = {};

	if (inputs.credentials) {
		const fields = parseSimpleYaml(readFileSync(inputs.credentials, "utf-8"));
		out.feishu = {
			appId: pickField(fields, ["app_id", "appId", "feishu.app_id", "feishu.appId"]),
			appSecret: pickField(fields, ["app_secret", "appSecret", "feishu.app_secret", "feishu.appSecret"]),
		};
	}
	if (inputs.config) {
		const fields = parseSimpleYaml(readFileSync(inputs.config, "utf-8"));
		const baseUrl = pickField(fields, ["baseUrl", "base_url", "feishu.baseUrl", "feishu.base_url"]);
		if (baseUrl) {
			out.feishu = { ...(out.feishu ?? {}), baseUrl };
		}
	}
	if (inputs.state) {
		try {
			const raw = readFileSync(inputs.state, "utf-8");
			const parsed = JSON.parse(raw) as {
				sessions?: Record<string, { userId: string; projectId: string; sessionPath: string; updatedAt: string }>;
			};
			if (parsed.sessions) {
				out.stateEntries = Object.values(parsed.sessions).map((s) => ({
					userId: s.userId,
					projectId: s.projectId,
					sessionPath: s.sessionPath,
					updatedAt: s.updatedAt,
				}));
			}
		} catch {
			// ignore — leave stateEntries undefined
		}
	}
	return out;
}

/**
 * Minimal YAML key:value extractor. Handles only the simple flat shapes
 * the legacy templates produced — quoted/unquoted scalars, comments,
 * 2-space nested indentation. We deliberately avoid pulling in the full
 * yaml dependency for migration code that should run at most once.
 *
 * Returns a flat dict where nested keys are joined with '.'.
 */
function parseSimpleYaml(text: string): Map<string, string> {
	const out = new Map<string, string>();
	const lines = text.split(/\r?\n/);
	const stack: { indent: number; prefix: string }[] = [{ indent: -1, prefix: "" }];
	for (const rawLine of lines) {
		const line = rawLine.replace(/#.*$/, "");
		if (line.trim().length === 0) continue;
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		const trimmed = line.slice(indent);
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx < 0) continue;
		const key = trimmed.slice(0, colonIdx).trim();
		const valueRaw = trimmed.slice(colonIdx + 1).trim();

		while (stack.length > 1 && (stack.at(-1) as { indent: number }).indent >= indent) {
			stack.pop();
		}
		const parent = stack.at(-1);
		if (!parent) continue;
		const fullKey = parent.prefix ? `${parent.prefix}.${key}` : key;

		if (valueRaw.length === 0) {
			stack.push({ indent, prefix: fullKey });
			continue;
		}
		out.set(fullKey, unquote(valueRaw));
	}
	return out;
}

function unquote(s: string): string {
	if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
		return s.slice(1, -1);
	}
	return s;
}

function pickField(map: Map<string, string>, keys: string[]): string | undefined {
	for (const k of keys) {
		const v = map.get(k);
		if (v) return v;
	}
	return undefined;
}

/**
 * Rename legacy files to .bak so detectLegacyImGateway no longer fires.
 * Best effort: if rename fails the wizard will simply re-prompt next
 * time, which is harmless.
 */
export function archiveLegacyFiles(detection: LegacyDetection): void {
	const stamp = Date.now();
	for (const path of [detection.configPath, detection.credentialsPath, detection.statePath]) {
		if (!path || !existsSync(path)) continue;
		try {
			renameSync(path, `${path}.${stamp}.bak`);
		} catch {
			// ignore
		}
	}
}
