import { resolveDownloadOs, resolveDownloadTarget, type DownloadTarget } from "./download-target";

export const DOWNLOAD_VERSION = "0.5.61";

type UserAgentData = {
	getHighEntropyValues?: (hints: readonly string[]) => Promise<{ architecture?: string }>;
};

function userAgentData(): UserAgentData | undefined {
	return (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
}

/** Chromium 能给出真实芯片架构；Safari / Firefox 拿不到，返回 undefined。 */
async function readArchitectureHint(): Promise<string | undefined> {
	try {
		const values = await userAgentData()?.getHighEntropyValues?.(["architecture"]);
		return values?.architecture;
	} catch {
		return undefined;
	}
}

/** 下载区推荐的平台图标高亮。 */
export function initDownloadPlatformHighlight() {
	const platform = resolveDownloadOs(navigator.userAgent);
	const iconMap: Record<string, string> = { macos: "ollama", windows: "kimi", linux: "grok" };
	document.querySelectorAll(".dl-platform-icon").forEach((el) => {
		const htmlEl = el as HTMLElement;
		if (htmlEl.dataset.p === iconMap[platform]) {
			htmlEl.style.opacity = "0.6";
			htmlEl.style.borderColor = "var(--accent)";
		}
	});
}

/* 下载链接：按系统与芯片选择产物，4 处同步更新（nav、hero CTA、下载区 primary、版本标签） */
export function initDownloadLinks() {
	const navDownload = document.querySelector<HTMLAnchorElement>(".nav__download");
	const heroDownload = document.querySelector<HTMLAnchorElement>(".hero .btn--primary.btn--lg");
	const dlPrimary = document.getElementById("dlPrimary") as HTMLAnchorElement | null;
	const dlPrimaryText = document.getElementById("dlPrimaryText");
	const dlPrimaryVersion = document.getElementById("dlPrimaryVersion");
	const userAgent = navigator.userAgent;
	// Chromium 能报出真实架构；探测期间先按 Apple 芯片落地，避免给 Apple 芯片用户闪一条 Intel 提示。
	const canReadArchitecture = typeof userAgentData()?.getHighEntropyValues === "function";

	function apply(target: DownloadTarget) {
		if (dlPrimary) dlPrimary.href = target.href;
		if (dlPrimaryText) dlPrimaryText.textContent = target.label;
		if (dlPrimaryVersion) dlPrimaryVersion.textContent = target.versionLabel;
		if (navDownload) navDownload.href = target.href;
		if (heroDownload) heroDownload.href = target.href;
	}

	apply(resolveDownloadTarget({ userAgent }, { version: DOWNLOAD_VERSION, intelHint: !canReadArchitecture }));
	if (!canReadArchitecture) return;

	void readArchitectureHint().then((architectureHint) => {
		apply(resolveDownloadTarget({ userAgent, architectureHint }, { version: DOWNLOAD_VERSION }));
	});
}
