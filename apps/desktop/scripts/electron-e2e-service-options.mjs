export function resolveElectronE2eServiceOptions({ platform = process.platform, ci = process.env.CI } = {}) {
	const options = { clearMocks: true };
	if (platform !== "linux" || ci !== "true") return options;

	// Ubuntu 24.04+ blocks Electron's unprivileged user namespace unless its
	// executable has a matching AppArmor profile. GitHub-hosted runners provide
	// non-interactive sudo and are ephemeral, so let the service install its
	// narrowly scoped profile instead of disabling Chromium's sandbox globally.
	return {
		...options,
		apparmorAutoInstall: "sudo",
	};
}

export function resolveElectronE2eSpecRetryOptions({
	platform = process.platform,
	packaged = process.env.VETTA_E2E_PACKAGED === "1",
} = {}) {
	const retries = platform === "linux" && packaged ? 1 : 0;
	return {
		specFileRetries: retries,
		specFileRetriesDelay: 0,
		specFileRetriesDeferred: false,
	};
}
