const SUPPORTED_PROVIDERS = new Set(["none", "generic", "github"]);

function requireValue(env, key, provider) {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`[update-publish] ${key} is required when VETTA_UPDATE_PROVIDER=${provider}`);
	}
	return value;
}

function normalizeHttpUrl(rawUrl) {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("[update-publish] VETTA_UPDATE_URL must use http or https");
	}
	return url.toString().replace(/\/+$/, "");
}

export function resolveUpdatePublishConfig(env = process.env) {
	const provider = (env.VETTA_UPDATE_PROVIDER ?? "none").trim().toLowerCase();
	if (!SUPPORTED_PROVIDERS.has(provider)) {
		throw new Error(
			`[update-publish] unsupported VETTA_UPDATE_PROVIDER=${provider}; expected none, generic, or github`,
		);
	}
	if (provider === "none") return null;

	if (provider === "generic") {
		return {
			provider: "generic",
			url: normalizeHttpUrl(requireValue(env, "VETTA_UPDATE_URL", provider)),
			useMultipleRangeRequest: true,
		};
	}

	return {
		provider: "github",
		owner: requireValue(env, "VETTA_UPDATE_GITHUB_OWNER", provider),
		repo: requireValue(env, "VETTA_UPDATE_GITHUB_REPO", provider),
		releaseType: "release",
	};
}
