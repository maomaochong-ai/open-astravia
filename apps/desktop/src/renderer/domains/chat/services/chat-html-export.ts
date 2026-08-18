import { i18n } from "@shared/i18n";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function collectStyleSheetText(): string {
	const chunks: string[] = [];
	for (const sheet of Array.from(document.styleSheets)) {
		try {
			for (const rule of Array.from(sheet.cssRules)) {
				chunks.push(rule.cssText);
			}
		} catch {
			// Desktop styles are local. Optional inaccessible stylesheets keep
			// their browser fallback instead of blocking the whole export.
		}
	}
	return chunks.join("\n");
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
		reader.readAsDataURL(blob);
	});
}

async function inlineImages(source: HTMLElement, clone: HTMLElement): Promise<void> {
	const sourceImages = Array.from(source.querySelectorAll("img"));
	const clonedImages = Array.from(clone.querySelectorAll("img"));
	await Promise.all(
		sourceImages.map(async (image, index) => {
			const clonedImage = clonedImages[index];
			if (!clonedImage) return;
			const src = image.currentSrc || image.src;
			if (!src || src.startsWith("data:")) return;
			try {
				const response = await fetch(src);
				if (!response.ok) return;
				clonedImage.src = await blobToDataUrl(await response.blob());
				clonedImage.removeAttribute("srcset");
			} catch {
				// Plugin/external images that cannot be read keep their original
				// URL. Core chat images are already data URLs.
			}
		}),
	);
}

function sanitizeSerializedTree(root: HTMLElement): void {
	for (const script of Array.from(root.querySelectorAll("script"))) {
		script.remove();
	}
	for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
		for (const attribute of Array.from(element.attributes)) {
			if (attribute.name.toLowerCase().startsWith("on")) {
				element.removeAttribute(attribute.name);
			}
		}
		if (element instanceof HTMLAnchorElement && element.href.toLowerCase().startsWith("javascript:")) {
			element.removeAttribute("href");
		}
	}
}

async function loadAppIconDataUrl(): Promise<string> {
	try {
		const response = await fetch("/icon.png");
		if (!response.ok) return "";
		return await blobToDataUrl(await response.blob());
	} catch {
		return "";
	}
}

function buildShareNav(iconDataUrl: string, nickname?: string): string {
	const desc = nickname
		? i18n.t("chat:export.shareNavDescriptionWithNickname", { nickname: escapeHtml(nickname) })
		: i18n.t("chat:export.shareNavDescription");
	const icon = iconDataUrl ? `<img class="vetta-share-nav__icon" src="${iconDataUrl}" alt="Vetta" />` : "";
	return `<nav class="vetta-share-nav" data-share-nav>
		<div class="vetta-share-nav__inner">
			${icon}
			<div class="vetta-share-nav__meta">
				<span class="vetta-share-nav__brand">Vetta</span>
				<span class="vetta-share-nav__desc">${desc}</span>
			</div>
		</div>
	</nav>`;
}

const EXPORT_SCRIPT = `
(function () {
	var nav = document.querySelector("[data-share-nav]");
	if (nav) {
		var update = function () { nav.classList.toggle("is-scrolled", window.scrollY > 4); };
		update();
		window.addEventListener("scroll", update, { passive: true });
	}
})();
document.addEventListener("click", function (event) {
	const button = event.target instanceof Element ? event.target.closest("[data-export-toggle]") : null;
	if (!(button instanceof HTMLElement)) return;
	const targetId = button.dataset.exportToggle;
	if (!targetId) return;
	const panel = document.getElementById(targetId);
	if (!panel) return;
	const expanded = panel.hidden;
	panel.hidden = !expanded;
	button.setAttribute("aria-expanded", String(expanded));
	const icon = button.querySelector('[class*="chevron-right"]');
	if (icon) icon.classList.toggle("rotate-90", expanded);
	const label = button.querySelector("[data-export-toggle-label]");
	if (label) {
		label.textContent = expanded
			? button.dataset.exportLabelExpanded || label.textContent
			: button.dataset.exportLabelCollapsed || label.textContent;
	}
});
`;

export async function buildChatHtmlDocument(root: HTMLElement, title: string, nickname?: string): Promise<string> {
	const clone = root.cloneNode(true) as HTMLElement;
	await inlineImages(root, clone);
	sanitizeSerializedTree(clone);

	const styleText = collectStyleSheetText().replaceAll("</style", "<\\/style");
	const colorScheme = getComputedStyle(document.documentElement).colorScheme;
	const iconDataUrl = await loadAppIconDataUrl();
	const shareNav = buildShareNav(iconDataUrl, nickname);

	return `<!doctype html>
<html lang="zh-CN" class="${escapeHtml(document.documentElement.className)}" style="${escapeHtml(document.documentElement.getAttribute("style") ?? "")}">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
	<title>${escapeHtml(title)}</title>
	<style>
		${styleText}
		:root { color-scheme: ${escapeHtml(colorScheme || "light dark")}; }
		html, body { min-height: 100%; }
		body { margin: 0; background: var(--background); color: var(--foreground); }
		[data-export-collapse-panel][hidden] { display: none !important; }
		.chat-export-document { min-height: 100vh; }
		.vetta-share-nav {
			position: sticky;
			top: 0;
			z-index: 50;
			padding: 10px 0;
			background: transparent;
			border-bottom: 1px solid transparent;
			transition: background .25s ease, backdrop-filter .25s ease, border-color .25s ease, box-shadow .25s ease;
		}
		.vetta-share-nav.is-scrolled {
			background: color-mix(in srgb, var(--background) 70%, transparent);
			backdrop-filter: saturate(180%) blur(16px);
			-webkit-backdrop-filter: saturate(180%) blur(16px);
			border-bottom-color: var(--border);
			box-shadow: 0 1px 14px -8px rgba(0, 0, 0, .35);
		}
		.vetta-share-nav__inner {
			display: flex;
			align-items: center;
			gap: 10px;
			width: 100%;
			max-width: 48rem;
			margin: 0 auto;
			padding: 0 20px;
			box-sizing: border-box;
		}
		.vetta-share-nav__icon { width: 30px; height: 30px; border-radius: 8px; flex: none; }
		.vetta-share-nav__meta { display: flex; flex-direction: column; line-height: 1.25; }
		.vetta-share-nav__brand { font-weight: 600; font-size: 14px; color: var(--foreground); }
		.vetta-share-nav__desc { font-size: 12px; color: var(--muted-foreground); }
	</style>
</head>
<body class="${escapeHtml(document.body.className)}" style="${escapeHtml(document.body.getAttribute("style") ?? "")}">
	${shareNav}
	${clone.outerHTML}
	<script>${EXPORT_SCRIPT}</script>
</body>
</html>`;
}
