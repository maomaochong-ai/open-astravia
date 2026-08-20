import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve desktop-release configuration.
 *
 * Precedence for a workflow_dispatch run:
 *   form input (when not empty / not "default") → Environment/repo vars → built-in default
 * Tag / other events ignore form inputs so a production tag cannot be steered by stale UI state.
 *
 * Secrets never belong here. This module only resolves non-secret build and publish settings.
 */

const RELEASE_TARGETS = new Set(["github", "r2"]);
const CHANNELS = new Set(["default", "stable", "test"]);
const FLAGS = new Set(["true", "false"]);
const CHANNEL_SEGMENTS = new Set(["stable", "test", "beta", "prod", "production"]);
const DEFAULT_OPEN_SOURCE_MARKETPLACE = "https://github.com/openvetta/vetta-official-marketplace";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeToken(value) {
	if (value == null) return "";
	if (typeof value === "boolean") return value ? "true" : "false";
	return String(value).trim();
}

/**
 * @param {...unknown} values
 * @returns {string}
 */
export function firstExplicit(...values) {
	for (const value of values) {
		const token = normalizeToken(value);
		if (token && token !== "default") return token;
	}
	return "";
}

/**
 * @param {string} value
 * @param {string} nextSegment
 */
export function replaceLastPathSegment(value, nextSegment) {
	const trimmed = normalizeToken(value);
	if (!trimmed) return "";
	try {
		const url = new URL(trimmed);
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts.length === 0) return trimmed;
		const last = parts.at(-1) ?? "";
		if (!CHANNEL_SEGMENTS.has(last.toLowerCase())) return trimmed;
		parts[parts.length - 1] = nextSegment;
		url.pathname = `/${parts.join("/")}`;
		return url.toString().replace(/\/$/, "");
	} catch {
		const parts = trimmed.split("/").filter((part, index) => part.length > 0 || index === 0);
		if (parts.length === 0) return trimmed;
		const last = parts.at(-1) ?? "";
		if (!CHANNEL_SEGMENTS.has(last.toLowerCase())) return trimmed;
		parts[parts.length - 1] = nextSegment;
		return parts.join("/");
	}
}

/**
 * @param {string} flag
 * @param {string} name
 */
function parseFlag(flag, name) {
	if (!flag) return "";
	if (!FLAGS.has(flag)) {
		throw new Error(`${name} must be true, false, or default (received ${JSON.stringify(flag)})`);
	}
	return flag;
}

/**
 * @param {object} request
 * @param {string} [request.eventName]
 * @param {string} [request.refType]
 * @param {Record<string, unknown>} [request.inputs]
 * @param {Record<string, unknown>} [request.vars]
 */
export function resolveDesktopReleaseConfig(request = {}) {
	const eventName = normalizeToken(request.eventName) || "workflow_dispatch";
	const refType = normalizeToken(request.refType);
	const inputs = request.inputs ?? {};
	const vars = request.vars ?? {};
	const acceptInputs = eventName === "workflow_dispatch";

	const pick = (inputKey, varKeys, fallback = "") => {
		const inputValue = acceptInputs ? inputs[inputKey] : "";
		const varValues = (Array.isArray(varKeys) ? varKeys : [varKeys]).map((key) => vars[key]);
		return firstExplicit(inputValue, ...varValues) || fallback;
	};

	const releaseTarget = pick("release_target", "VETTA_RELEASE_TARGET", "github");
	if (!RELEASE_TARGETS.has(releaseTarget)) {
		throw new Error(`release_target must be github or r2 (received ${JSON.stringify(releaseTarget)})`);
	}
	const configuredCloudEnabled = parseFlag(
		pick("cloud_enabled", "VETTA_CLOUD_ENABLED"),
		"cloud_enabled",
	);
	const cloudEnabled = configuredCloudEnabled || (releaseTarget === "github" ? "false" : "true");
	if (releaseTarget === "github" && cloudEnabled !== "false") {
		throw new Error("GitHub Releases can only publish the open-source build (cloud_enabled=false)");
	}
	if (releaseTarget === "r2" && cloudEnabled !== "true") {
		throw new Error("R2 can only publish the commercial build (cloud_enabled=true)");
	}
	const speechInput = parseFlag(pick("speech_input", "VETTA_SPEECH_INPUT_ENABLED"), "speech_input");

	const channel = pick("channel", "VETTA_RELEASE_CHANNEL", "default");
	if (!CHANNELS.has(channel)) {
		throw new Error(`channel must be default, stable, or test (received ${JSON.stringify(channel)})`);
	}
	if (channel === "test" && releaseTarget !== "r2") {
		throw new Error("the test channel must publish to R2");
	}
	if (eventName !== "workflow_dispatch" && channel === "test") {
		throw new Error("the test channel is only available through workflow_dispatch");
	}
	const buildVersion = pick("build_version", "VETTA_TEST_BUILD_VERSION");
	if (buildVersion && channel !== "test") {
		throw new Error("build_version is only allowed for the test channel");
	}
	if (buildVersion && !VERSION_PATTERN.test(buildVersion)) {
		throw new Error(`build_version must be a semantic desktop version (received ${JSON.stringify(buildVersion)})`);
	}
	const shouldPublish =
		(eventName === "push" && refType === "tag") ||
		(eventName === "workflow_dispatch" && (channel === "test" || channel === "stable"));

	const serverUrl = cloudEnabled === "true" ? pick("server_url", "VETTA_SERVER_URL") : "";
	const siteUrl = cloudEnabled === "true" ? pick("site_url", "VETTA_SITE_URL") : "";
	const marketplaceRepository =
		cloudEnabled === "false"
			? pick(
					"marketplace_repository",
					"VETTA_OPEN_MARKETPLACE_REPOSITORY",
					DEFAULT_OPEN_SOURCE_MARKETPLACE,
				)
			: "";
	const tenant = pick("tenant", "VETTA_TENANT");
	const notes = acceptInputs ? normalizeToken(inputs.notes).replaceAll(/\s+/g, " ") : "";

	let updateUrl = pick("update_url", "VETTA_UPDATE_URL");
	let r2Bucket = pick("r2_bucket", "VETTA_R2_BUCKET");
	let r2Prefix = pick("r2_prefix", "VETTA_R2_PREFIX");

	if (channel === "test") {
		updateUrl = firstExplicit(acceptInputs ? inputs.update_url : "", vars.VETTA_UPDATE_URL_TEST, replaceLastPathSegment(updateUrl, "test"), updateUrl);
		r2Prefix = firstExplicit(acceptInputs ? inputs.r2_prefix : "", vars.VETTA_R2_PREFIX_TEST, replaceLastPathSegment(r2Prefix, "test"), r2Prefix);
	} else if (channel === "stable") {
		updateUrl = firstExplicit(acceptInputs ? inputs.update_url : "", vars.VETTA_UPDATE_URL_STABLE, updateUrl);
		r2Prefix = firstExplicit(acceptInputs ? inputs.r2_prefix : "", vars.VETTA_R2_PREFIX_STABLE, r2Prefix);
	}
	if (releaseTarget === "github") updateUrl = "";

	if (cloudEnabled === "true" && !serverUrl) {
		throw new Error("VETTA_SERVER_URL is required when VETTA_CLOUD_ENABLED=true");
	}

	return {
		buildVersion,
		channel,
		cloudEnabled,
		marketplaceRepository,
		notes,
		r2Bucket,
		r2Prefix,
		releaseTarget,
		shouldPublish,
		serverUrl,
		siteUrl,
		speechInput,
		tenant,
		updateProvider: releaseTarget === "r2" ? "generic" : "github",
		updateUrl,
	};
}

/**
 * @param {ReturnType<typeof resolveDesktopReleaseConfig>} config
 */
export function toGithubOutput(config) {
	return [
		`build_version=${config.buildVersion}`,
		`channel=${config.channel}`,
		`cloud_enabled=${config.cloudEnabled}`,
		`marketplace_repository=${config.marketplaceRepository}`,
		`notes=${config.notes}`,
		`r2_bucket=${config.r2Bucket}`,
		`r2_prefix=${config.r2Prefix}`,
		`release_target=${config.releaseTarget}`,
		`should_publish=${config.shouldPublish}`,
		`server_url=${config.serverUrl}`,
		`site_url=${config.siteUrl}`,
		`speech_input=${config.speechInput}`,
		`tenant=${config.tenant}`,
		`update_provider=${config.updateProvider}`,
		`update_url=${config.updateUrl}`,
	].join("\n");
}

/**
 * @param {ReturnType<typeof resolveDesktopReleaseConfig>} config
 */
export function toGithubEnv(config) {
	const entries = [
		["VETTA_DESKTOP_BUILD_VERSION", config.buildVersion],
		["VETTA_RELEASE_PUBLISH", config.shouldPublish ? "true" : "false"],
		["VETTA_CLOUD_ENABLED", config.cloudEnabled],
		["VETTA_SERVER_URL", config.serverUrl],
		["VETTA_SITE_URL", config.siteUrl],
		["VETTA_OPEN_MARKETPLACE_REPOSITORY", config.marketplaceRepository],
		["VETTA_TENANT", config.tenant],
		["VETTA_SPEECH_INPUT_ENABLED", config.speechInput],
		["VETTA_UPDATE_PROVIDER", config.updateProvider],
		["VETTA_UPDATE_URL", config.updateUrl],
		["VETTA_R2_BUCKET", config.r2Bucket],
		["VETTA_R2_PREFIX", config.r2Prefix],
	];
	return entries
		.filter(([, value]) => value !== "")
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

/**
 * @param {ReturnType<typeof resolveDesktopReleaseConfig>} config
 */
export function toSummaryMarkdown(config) {
	const rows = [
		["build_version", config.buildVersion || "(package version)"],
		["channel", config.channel],
		["cloud_enabled", config.cloudEnabled || "(invalid: unset)"],
		["server_url", config.serverUrl || "(unset)"],
		["site_url", config.siteUrl || "(unset)"],
		["marketplace_repository", config.marketplaceRepository || "(unset)"],
		["tenant", config.tenant || "(unset)"],
		["speech_input", config.speechInput || "(unset)"],
		["release_target", config.releaseTarget],
		["should_publish", config.shouldPublish ? "true" : "false"],
		["update_provider", config.updateProvider],
		["update_url", config.updateUrl || "(unset)"],
		["r2_bucket", config.r2Bucket || "(unset)"],
		["r2_prefix", config.r2Prefix || "(unset)"],
	];
	const body = rows.map(([key, value]) => `| ${key} | \`${value}\` |`).join("\n");
	const notes = config.notes ? `\n\nNotes: ${config.notes}` : "";
	return `### Desktop release config\n\n| Key | Value |\n| --- | --- |\n${body}${notes}\n`;
}

function readRequestFromEnv(env = process.env) {
	return {
		eventName: env.EVENT_NAME,
		refType: env.REF_TYPE,
		inputs: {
			build_version: env.INPUT_BUILD_VERSION,
			channel: env.INPUT_CHANNEL,
			cloud_enabled: env.INPUT_CLOUD_ENABLED,
			marketplace_repository: env.INPUT_MARKETPLACE_REPOSITORY,
			notes: env.INPUT_NOTES,
			r2_bucket: env.INPUT_R2_BUCKET,
			r2_prefix: env.INPUT_R2_PREFIX,
			release_target: env.INPUT_RELEASE_TARGET,
			server_url: env.INPUT_SERVER_URL,
			site_url: env.INPUT_SITE_URL,
			speech_input: env.INPUT_SPEECH_INPUT,
			tenant: env.INPUT_TENANT,
			update_url: env.INPUT_UPDATE_URL,
		},
		vars: {
			VETTA_TEST_BUILD_VERSION: env.VAR_TEST_BUILD_VERSION,
			VETTA_CLOUD_ENABLED: env.VAR_CLOUD_ENABLED,
			VETTA_OPEN_MARKETPLACE_REPOSITORY: env.VAR_MARKETPLACE_REPOSITORY,
			VETTA_R2_BUCKET: env.VAR_R2_BUCKET,
			VETTA_R2_PREFIX: env.VAR_R2_PREFIX,
			VETTA_R2_PREFIX_STABLE: env.VAR_R2_PREFIX_STABLE,
			VETTA_R2_PREFIX_TEST: env.VAR_R2_PREFIX_TEST,
			VETTA_RELEASE_CHANNEL: env.VAR_RELEASE_CHANNEL,
			VETTA_RELEASE_TARGET: env.VAR_RELEASE_TARGET,
			VETTA_SERVER_URL: env.VAR_SERVER_URL,
			VETTA_SITE_URL: env.VAR_SITE_URL,
			VETTA_SPEECH_INPUT_ENABLED: env.VAR_SPEECH_INPUT,
			VETTA_TENANT: env.VAR_TENANT,
			VETTA_UPDATE_URL: env.VAR_UPDATE_URL,
			VETTA_UPDATE_URL_STABLE: env.VAR_UPDATE_URL_STABLE,
			VETTA_UPDATE_URL_TEST: env.VAR_UPDATE_URL_TEST,
		},
	};
}

function readConfigFromOutputs(env = process.env) {
	return {
		buildVersion: normalizeToken(env.OUTPUT_BUILD_VERSION),
		channel: normalizeToken(env.OUTPUT_CHANNEL) || "default",
		cloudEnabled: normalizeToken(env.OUTPUT_CLOUD_ENABLED),
		marketplaceRepository: normalizeToken(env.OUTPUT_MARKETPLACE_REPOSITORY),
		notes: normalizeToken(env.OUTPUT_NOTES),
		r2Bucket: normalizeToken(env.OUTPUT_R2_BUCKET),
		r2Prefix: normalizeToken(env.OUTPUT_R2_PREFIX),
		releaseTarget: normalizeToken(env.OUTPUT_RELEASE_TARGET) || "github",
		shouldPublish: normalizeToken(env.OUTPUT_SHOULD_PUBLISH) === "true",
		serverUrl: normalizeToken(env.OUTPUT_SERVER_URL),
		siteUrl: normalizeToken(env.OUTPUT_SITE_URL),
		speechInput: normalizeToken(env.OUTPUT_SPEECH_INPUT),
		tenant: normalizeToken(env.OUTPUT_TENANT),
		updateProvider: normalizeToken(env.OUTPUT_UPDATE_PROVIDER),
		updateUrl: normalizeToken(env.OUTPUT_UPDATE_URL),
	};
}

function main(argv = process.argv.slice(2), env = process.env, io = console) {
	const exportEnv = argv.includes("--export-env");
	const githubOutput = argv.includes("--github-output");
	const fromOutputs = argv.includes("--from-outputs");
	const summary = argv.includes("--summary");
	const config = fromOutputs ? readConfigFromOutputs(env) : resolveDesktopReleaseConfig(readRequestFromEnv(env));

	if (exportEnv) {
		const text = toGithubEnv(config);
		if (text) io.log(text);
		return;
	}
	if (githubOutput) {
		io.log(toGithubOutput(config));
		return;
	}
	if (summary) {
		io.log(toSummaryMarkdown(config));
		return;
	}
	io.log(JSON.stringify(config, null, 2));
}

function isExecutedDirectly() {
	const invoked = process.argv[1];
	if (!invoked) return false;
	return fileURLToPath(import.meta.url).toLowerCase() === resolve(invoked).toLowerCase();
}

if (isExecutedDirectly()) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
