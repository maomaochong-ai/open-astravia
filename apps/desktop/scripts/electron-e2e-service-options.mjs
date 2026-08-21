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
