const SUPPORTED_PROVIDERS = new Set(["generic", "github"]);
const DEFAULT_UPDATE_PROVIDER = "generic";
const DEFAULT_UPDATE_URL = "https://releases.astravia.dev/desktop/stable";

function requireValue(env, key, provider) {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`[update-publish] ${key} is required when ASTRAVIA_UPDATE_PROVIDER=${provider}`);
	}
	return value;
}

function normalizeHttpUrl(rawUrl) {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("[update-publish] ASTRAVIA_UPDATE_URL must use http or https");
	}
	return url.toString().replace(/\/+$/, "");
}

export function resolveUpdatePublishConfig(env = process.env) {
	const provider = (env.ASTRAVIA_UPDATE_PROVIDER?.trim() || DEFAULT_UPDATE_PROVIDER).toLowerCase();
	if (!SUPPORTED_PROVIDERS.has(provider)) {
		throw new Error(
			`[update-publish] unsupported ASTRAVIA_UPDATE_PROVIDER=${provider}; expected generic or github`,
		);
	}
	if (provider === "generic") {
		return {
			provider: "generic",
			url: normalizeHttpUrl(env.ASTRAVIA_UPDATE_URL?.trim() || DEFAULT_UPDATE_URL),
			useMultipleRangeRequest: true,
		};
	}

	return {
		provider: "github",
		owner: requireValue(env, "ASTRAVIA_UPDATE_GITHUB_OWNER", provider),
		repo: requireValue(env, "ASTRAVIA_UPDATE_GITHUB_REPO", provider),
		releaseType: "release",
	};
}
