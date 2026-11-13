import { resolveDownloadOs, resolveDownloadTarget, type DownloadTarget } from "./download-target";

export const DOWNLOAD_VERSION = "0.5.94";

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
			htmlEl.style.borderColor = "color-mix(in srgb, var(--accent) 55%, var(--line-card))";
			htmlEl.style.boxShadow = "0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent) inset";
		}
	});
}

/**
 * 下载链接：按系统与芯片选择产物，两处同步更新（下载区主按钮、版本标签）。
 *
 * 首页首屏不再挂直接下载按钮：它是「开始使用」锚点，落到下载区由这里决定最终产物。
 * 只有一处 href 需要写，也就没有「首屏与下载区指向不同安装包」的可能。
 */
export function initDownloadLinks() {
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
	}

	apply(resolveDownloadTarget({ userAgent }, { version: DOWNLOAD_VERSION, intelHint: !canReadArchitecture }));
	if (!canReadArchitecture) return;

	void readArchitectureHint().then((architectureHint) => {
		apply(resolveDownloadTarget({ userAgent, architectureHint }, { version: DOWNLOAD_VERSION }));
	});
}
