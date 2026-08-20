import { describe, expect, it } from "vitest";
import {
	firstExplicit,
	replaceLastPathSegment,
	resolveDesktopReleaseConfig,
	toGithubEnv,
	toGithubOutput,
} from "./resolve-desktop-release-config.mjs";

describe("firstExplicit", () => {
	it("skips empty, default, and whitespace tokens", () => {
		expect(firstExplicit("", "default", "  ", "true")).toBe("true");
	});
});

describe("replaceLastPathSegment", () => {
	it("rewrites a URL channel segment", () => {
		expect(replaceLastPathSegment("https://releases.example.com/desktop/stable", "test")).toBe(
			"https://releases.example.com/desktop/test",
		);
	});

	it("rewrites a plain prefix", () => {
		expect(replaceLastPathSegment("desktop/stable", "test")).toBe("desktop/test");
	});

	it("leaves unrelated paths alone", () => {
		expect(replaceLastPathSegment("desktop/artifacts", "test")).toBe("desktop/artifacts");
	});
});

describe("resolveDesktopReleaseConfig", () => {
	it("defaults a fork-style tag run to open-source + GitHub Releases", () => {
		expect(resolveDesktopReleaseConfig({ eventName: "push", refType: "tag", vars: {} })).toMatchObject({
			channel: "default",
			cloudEnabled: "false",
			marketplaceRepository: "https://github.com/openvetta/vetta-official-marketplace",
			releaseTarget: "github",
			shouldPublish: true,
			updateProvider: "github",
			serverUrl: "",
		});
	});

	it("uses Environment/repo vars on a tag and ignores leftover form inputs", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "push",
			inputs: { cloud_enabled: "false", server_url: "https://evil.example" },
			vars: {
				VETTA_CLOUD_ENABLED: "true",
				VETTA_RELEASE_TARGET: "r2",
				VETTA_SERVER_URL: "https://api.example.com/api/v1",
				VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable",
			},
		});
		expect(config).toMatchObject({
			cloudEnabled: "true",
			releaseTarget: "r2",
			serverUrl: "https://api.example.com/api/v1",
			updateProvider: "generic",
			updateUrl: "https://releases.example.com/desktop/stable",
		});
	});

	it("lets workflow_dispatch inputs override vars", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: {
				channel: "test",
				cloud_enabled: "true",
				release_target: "r2",
				server_url: "https://api.staging.example.com/api/v1",
			},
			vars: {
				VETTA_CLOUD_ENABLED: "true",
				VETTA_R2_PREFIX: "desktop/stable",
				VETTA_SERVER_URL: "https://api.example.com/api/v1",
				VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable",
			},
		});
		expect(config.serverUrl).toBe("https://api.staging.example.com/api/v1");
		expect(config.updateUrl).toBe("https://releases.example.com/desktop/test");
		expect(config.r2Prefix).toBe("desktop/test");
	});

	it("marks only explicit stable/test dispatches and matching tags for publication", () => {
		expect(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "stable" },
			}),
		).toMatchObject({ shouldPublish: true });
		expect(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "default" },
			}),
		).toMatchObject({ shouldPublish: false });
		expect(
			resolveDesktopReleaseConfig({
				eventName: "push",
				refType: "branch",
				vars: {},
			}),
		).toMatchObject({ shouldPublish: false });
	});

	it("prefers dedicated test vars over last-segment rewrite", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: { channel: "test", release_target: "r2" },
			vars: {
				VETTA_SERVER_URL: "https://api.example.com/api/v1",
				VETTA_R2_PREFIX: "desktop/stable",
				VETTA_R2_PREFIX_TEST: "desktop/nightly",
				VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable",
				VETTA_UPDATE_URL_TEST: "https://releases.example.com/desktop/nightly",
			},
		});
		expect(config.updateUrl).toBe("https://releases.example.com/desktop/nightly");
		expect(config.r2Prefix).toBe("desktop/nightly");
	});

	it("allows an explicit monotonic test build version only on the test channel", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: { channel: "test", build_version: "0.5.47", release_target: "r2" },
			vars: { VETTA_SERVER_URL: "https://api.example.com/api/v1" },
		});
		expect(config.buildVersion).toBe("0.5.47");
		expect(toGithubEnv(config)).toContain("VETTA_DESKTOP_BUILD_VERSION=0.5.47");
		expect(toGithubEnv(config)).toContain("VETTA_RELEASE_PUBLISH=true");
		expect(toGithubOutput(config)).toContain("build_version=0.5.47");
	});

	it("rejects a test build version on stable or with an invalid version", () => {
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "stable", build_version: "0.5.47" },
			}),
		).toThrow(/only allowed for the test channel/);
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "test", build_version: "0.5", release_target: "r2" },
			}),
		).toThrow(/semantic desktop version/);
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { channel: "test", release_target: "github" },
			}),
		).toThrow(/test channel must publish to R2/);
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "push",
				vars: {
					VETTA_RELEASE_CHANNEL: "test",
					VETTA_RELEASE_TARGET: "r2",
					VETTA_SERVER_URL: "https://api.example.com/api/v1",
				},
			}),
		).toThrow(/only available through workflow_dispatch/);
	});

	it("rejects a full build without a server URL", () => {
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { cloud_enabled: "true", release_target: "r2" },
				vars: {},
			}),
		).toThrow(/VETTA_SERVER_URL/);
	});

	it("rejects mixing release targets and desktop editions", () => {
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "github", cloud_enabled: "true" },
			}),
		).toThrow(/open-source build/);
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "r2", cloud_enabled: "false" },
			}),
		).toThrow(/commercial build/);
	});

	it("omits empty optional keys from GITHUB_ENV", () => {
		const env = toGithubEnv(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "r2" },
				vars: {
					VETTA_SERVER_URL: "https://api.example.com/api/v1",
					VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable",
				},
			}),
		);
		expect(env).toContain("VETTA_UPDATE_PROVIDER=generic");
		expect(env).toContain("VETTA_UPDATE_URL=https://releases.example.com/desktop/stable");
		expect(env).toContain("VETTA_CLOUD_ENABLED=true");
		expect(env).not.toContain("VETTA_TENANT=");
	});

	it("writes GitHub output lines for the workflow", () => {
		const output = toGithubOutput(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "github", notes: "rehearsal" },
			}),
		);
		expect(output).toContain("release_target=github");
		expect(output).toContain("notes=rehearsal");
		expect(output).toContain("update_provider=github");
	});
});
