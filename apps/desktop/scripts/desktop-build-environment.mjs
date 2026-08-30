import { resolveMacSigningConfig } from "./mac-signing-config.mjs";
import { resolveSpeechInputBuildConfig } from "./speech-input-build-config.js";
import { resolveSystemPluginSelection } from "./stage-system-plugins.mjs";
import { resolveUpdatePublishConfig } from "./resolve-update-publish-config.mjs";

export const OPEN_SOURCE_BUILD_DEFAULTS = Object.freeze({
	VETTA_BUILD_ENV: "opensource",
	VETTA_CLOUD_ENABLED: "false",
	VETTA_UPDATE_PROVIDER: "github",
	VETTA_UPDATE_GITHUB_OWNER: "openvetta",
	VETTA_UPDATE_GITHUB_REPO: "open-vetta",
});

const SUPPORTED_PLATFORM_TAGS = new Set([
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64",
]);
const OPTIONAL_BOOLEAN_KEYS = [
	"VETTA_MAIN_SOURCEMAP",
	"VETTA_POSTHOG_REPLAY_ENABLED",
	"VETTA_SHOW_UI_THEME",
];
const OPTIONAL_ZERO_ONE_KEYS = ["VETTA_REQUIRE_MAC_SIGNATURE"];
const SAMPLE_RATE_KEYS = ["VETTA_POSTHOG_REPLAY_SAMPLE_RATE", "VETTA_SENTRY_TRACES_SAMPLE_RATE"];
const MARKETPLACE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const GITHUB_COORDINATE_PATTERN = /^[A-Za-z0-9_.-]+$/;

function readValue(env, key) {
	const value = env[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function validateExactFlag(env, key, allowed, errors, { required = false } = {}) {
	const value = readValue(env, key);
	if (value === undefined) {
		if (required) errors.push(`${key} must be explicitly set to ${allowed.join(" or ")}`);
		return undefined;
	}
	if (!allowed.includes(value)) {
		errors.push(`${key} must be ${allowed.map((item) => JSON.stringify(item)).join(" or ")}`);
		return undefined;
	}
	return value;
}

function validateHttpUrl(
	env,
	key,
	errors,
	{ required = false, httpsOnly = false, allowCredentials = false } = {},
) {
	const value = readValue(env, key);
	if (value === undefined) {
		if (required) errors.push(`${key} is required`);
		return undefined;
	}
	try {
		const url = new URL(value);
		if ((httpsOnly && url.protocol !== "https:") || (!httpsOnly && !["http:", "https:"].includes(url.protocol))) {
			errors.push(`${key} must use ${httpsOnly ? "https" : "http or https"}`);
		}
		if (!allowCredentials && (url.username || url.password)) {
			errors.push(`${key} must not contain credentials`);
		}
		return url;
	} catch {
		errors.push(`${key} must be a valid URL`);
		return undefined;
	}
}

function validateMarketplaceRepository(env, errors) {
	const repository = readValue(env, "VETTA_OPEN_MARKETPLACE_REPOSITORY");
	if (repository && !/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.test(repository)) {
		try {
			const url = new URL(repository.replace(/\.git$/i, "").replace(/\/$/, ""));
			const segments = url.pathname.split("/").filter(Boolean);
			if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || segments.length !== 2) {
				errors.push(
					"VETTA_OPEN_MARKETPLACE_REPOSITORY must be a GitHub owner/repo or https://github.com/owner/repo",
				);
			}
		} catch {
			errors.push(
				"VETTA_OPEN_MARKETPLACE_REPOSITORY must be a GitHub owner/repo or https://github.com/owner/repo",
			);
		}
	}

	const ref = readValue(env, "VETTA_OPEN_MARKETPLACE_REF") ?? "main";
	if (!MARKETPLACE_REF_PATTERN.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
		errors.push("VETTA_OPEN_MARKETPLACE_REF is invalid");
	}
	if (readValue(env, "VETTA_OPEN_MARKETPLACE_ARCHIVE_URL")) {
		validateHttpUrl(env, "VETTA_OPEN_MARKETPLACE_ARCHIVE_URL", errors, { httpsOnly: true });
	}
}

function parsePlatformList(env, key, errors) {
	const raw = readValue(env, key);
	if (!raw) return undefined;
	const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
	if (values.length === 0) {
		errors.push(`${key} must contain at least one platform tag`);
		return [];
	}
	if (key === "VETTA_VENDOR_PLATFORM" && values.length !== 1) {
		errors.push("VETTA_VENDOR_PLATFORM must contain exactly one platform tag");
	}
	for (const value of new Set(values)) {
		if (!SUPPORTED_PLATFORM_TAGS.has(value)) {
			errors.push(`${key} contains unsupported platform ${JSON.stringify(value)}`);
		}
	}
	if (new Set(values).size !== values.length) errors.push(`${key} contains duplicate platform tags`);
	return values;
}

function resolveTargetPlatformTags(env, platform, arch, errors) {
	const vendor = parsePlatformList(env, "VETTA_VENDOR_PLATFORM", errors);
	const cli = parsePlatformList(env, "VETTA_CLI_TARGET_PLATFORMS", errors);
	const gateway = parsePlatformList(env, "VETTA_IM_GATEWAY_TARGET_PLATFORMS", errors);
	const effective = gateway ?? cli ?? vendor ?? [`${platform}-${arch}`];
	for (const value of effective) {
		if (!SUPPORTED_PLATFORM_TAGS.has(value)) {
			errors.push(`build host resolves to unsupported platform ${JSON.stringify(value)}`);
		}
	}
	if (vendor) {
		const target = vendor[0];
		if (target && cli && !cli.includes(target)) errors.push("VETTA_CLI_TARGET_PLATFORMS must include VETTA_VENDOR_PLATFORM");
		if (target && gateway && !gateway.includes(target)) {
			errors.push("VETTA_IM_GATEWAY_TARGET_PLATFORMS must include VETTA_VENDOR_PLATFORM");
		}
	}
	return effective;
}

function validateUpdateConfiguration(updateConfig, productionUrls, errors) {
	if (!updateConfig) return;
	if (updateConfig.provider === "generic") {
		const url = new URL(updateConfig.url);
		if (productionUrls && url.protocol !== "https:") {
			errors.push("VETTA_UPDATE_URL must use https for a production build");
		}
		if (url.username || url.password) errors.push("VETTA_UPDATE_URL must not contain credentials");
		if (url.search || url.hash) errors.push("VETTA_UPDATE_URL must not contain a query or fragment");
		return;
	}
	if (!GITHUB_COORDINATE_PATTERN.test(updateConfig.owner)) {
		errors.push("VETTA_UPDATE_GITHUB_OWNER must be a valid GitHub owner");
	}
	if (!GITHUB_COORDINATE_PATTERN.test(updateConfig.repo)) {
		errors.push("VETTA_UPDATE_GITHUB_REPO must be a valid GitHub repository name");
	}
}

function validateTelemetry(env, productionUrls, errors) {
	for (const key of SAMPLE_RATE_KEYS) {
		const value = readValue(env, key);
		if (value === undefined) continue;
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) errors.push(`${key} must be between 0 and 1`);
	}
	if (readValue(env, "VETTA_SENTRY_DSN")) {
		validateHttpUrl(env, "VETTA_SENTRY_DSN", errors, {
			httpsOnly: productionUrls,
			allowCredentials: true,
		});
	}
	if (readValue(env, "VETTA_SENTRY_URL")) {
		validateHttpUrl(env, "VETTA_SENTRY_URL", errors, { httpsOnly: productionUrls });
	}
	if (readValue(env, "VETTA_POSTHOG_HOST")) {
		validateHttpUrl(env, "VETTA_POSTHOG_HOST", errors, { httpsOnly: productionUrls });
	}
	const telemetryEnvironment = readValue(env, "VETTA_TELEMETRY_ENVIRONMENT");
	if (telemetryEnvironment && !["development", "staging", "production"].includes(telemetryEnvironment)) {
		errors.push("VETTA_TELEMETRY_ENVIRONMENT must be development, staging, or production");
	}
	const posthogKey = readValue(env, "VETTA_POSTHOG_KEY");
	if (posthogKey && !posthogKey.startsWith("phc_")) {
		errors.push("VETTA_POSTHOG_KEY must be a PostHog project API key starting with phc_");
	}

	const uploadKeys = ["VETTA_SENTRY_AUTH_TOKEN", "VETTA_SENTRY_ORG", "VETTA_SENTRY_PROJECT"];
	if (uploadKeys.some((key) => readValue(env, key))) {
		for (const key of [...uploadKeys, "VETTA_SENTRY_RELEASE"]) {
			if (!readValue(env, key)) errors.push(`${key} is required when Sentry source-map upload is configured`);
		}
	}
	if (readValue(env, "VETTA_POSTHOG_REPLAY_ENABLED") === "true" && !readValue(env, "VETTA_POSTHOG_KEY")) {
		errors.push("VETTA_POSTHOG_KEY is required when VETTA_POSTHOG_REPLAY_ENABLED=true");
	}
}

export function createOpenSourceBuildEnvironment(env = process.env) {
	const next = { ...env, ...OPEN_SOURCE_BUILD_DEFAULTS };
	next.VETTA_SERVER_URL = "";
	next.VETTA_SITE_URL = "";
	for (const key of [
		"VETTA_OPEN_MARKETPLACE_REPOSITORY",
		"VETTA_OPEN_MARKETPLACE_REF",
		"VETTA_UPDATE_GITHUB_OWNER",
		"VETTA_UPDATE_GITHUB_REPO",
	]) {
		const configured = readValue(env, key);
		if (configured) next[key] = configured;
	}
	return next;
}

export function validateDesktopBuildEnvironment({
	env = process.env,
	mode = env.VETTA_BUILD_ENV?.trim() || "production",
	platform = process.platform,
	arch = process.arch,
} = {}) {
	const errors = [];
	const cloudFlag = validateExactFlag(env, "VETTA_CLOUD_ENABLED", ["true", "false"], errors, { required: true });
	for (const key of OPTIONAL_BOOLEAN_KEYS) validateExactFlag(env, key, ["true", "false"], errors);
	for (const key of OPTIONAL_ZERO_ONE_KEYS) validateExactFlag(env, key, ["0", "1"], errors);

	const platformTags = resolveTargetPlatformTags(env, platform, arch, errors);
	try {
		resolveSpeechInputBuildConfig({ env, platform, arch, platformTags });
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}

	let updateConfig;
	try {
		updateConfig = resolveUpdatePublishConfig(env);
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}

	let pluginSelection;
	try {
		pluginSelection = resolveSystemPluginSelection(env.VETTA_TENANT, "production");
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}

	const productionUrls = mode === "production";
	validateUpdateConfiguration(updateConfig, productionUrls, errors);
	if (cloudFlag === "true") {
		validateHttpUrl(env, "VETTA_SERVER_URL", errors, { required: true, httpsOnly: productionUrls });
		if (readValue(env, "VETTA_SITE_URL")) {
			validateHttpUrl(env, "VETTA_SITE_URL", errors, { httpsOnly: productionUrls });
		}
		if (updateConfig && updateConfig.provider !== "generic") {
			errors.push("commercial builds must use VETTA_UPDATE_PROVIDER=generic");
		}
	} else if (cloudFlag === "false") {
		if (readValue(env, "VETTA_SERVER_URL")) errors.push("VETTA_SERVER_URL must be empty for an open-source build");
		if (readValue(env, "VETTA_SITE_URL")) errors.push("VETTA_SITE_URL must be empty for an open-source build");
		if (updateConfig && updateConfig.provider !== "github") {
			errors.push("open-source builds must use VETTA_UPDATE_PROVIDER=github");
		}
	}
	validateMarketplaceRepository(env, errors);

	validateTelemetry(env, productionUrls, errors);
	let macSigning;
	try {
		macSigning = resolveMacSigningConfig(env);
		if (
			readValue(env, "VETTA_REQUIRE_MAC_SIGNATURE") === "1" &&
			platformTags.some((tag) => tag.startsWith("darwin-")) &&
			(!macSigning.enabled || !macSigning.notarize)
		) {
			errors.push("VETTA_REQUIRE_MAC_SIGNATURE=1 requires macOS signing and notarization");
		}
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}

	if (errors.length > 0) {
		throw new Error(`[desktop-build-env] invalid build environment:\n${errors.map((item) => `- ${item}`).join("\n")}`);
	}

	return {
		edition: cloudFlag === "true" ? "commercial" : "opensource",
		mode,
		platformTags,
		pluginSelection,
		updateConfig,
		macSigning,
	};
}
