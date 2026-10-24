import { createRoot } from "react-dom/client";
import { MarkdownContent } from "@astravia-org/theme-ui/markdown";
import type { MarkdownHost } from "@astravia-org/theme-ui/markdown";
import "@renderer/styles.css";

/** Deterministic site icon, so the resolved branch never touches the network. */
const SITE_ICON =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%2344cc44'/%3E%3C/svg%3E";

function hostWith(favicon: MarkdownHost["favicon"]): MarkdownHost {
	return {
		openHtml: async () => () => {},
		renderMermaid: async () => "",
		favicon,
		resolveImage: async (source) => source,
		copyImage: async () => {},
		saveImage: async () => {},
		openImage: () => {},
	};
}

const labels = { copy: "Copy", copied: "Copied" };
const text = "百度首页链接：[百度](https://www.baidu.com/) 与 [另一个页面](https://www.example.com/)";

/**
 * Two rows of the same link badges: `has-icon` resolves a site icon, `no-icon` keeps the
 * generic globe fallback. Chat and file previews share this leaf renderer.
 */
const root = document.createElement("div");
root.id = "host";
root.setAttribute("data-mode", "dark");
root.style.width = "520px";
root.style.padding = "16px";
document.body.style.margin = "0";
document.body.style.background = "rgb(20, 22, 30)";
document.body.append(root);
createRoot(root).render(
	<div>
		<div id="has-icon">
			<MarkdownContent
				host={hostWith(async () => SITE_ICON)}
				text={text}
				theme="dark"
				labels={labels}
				getFileIconClass={() => "icon-[mdi--file-document-outline]"}
				onOpenFile={() => {}}
				onOpenUrl={() => {}}
			/>
		</div>
		<div id="no-icon">
			<MarkdownContent
				host={hostWith(async () => null)}
				text={text}
				theme="dark"
				labels={labels}
				getFileIconClass={() => "icon-[mdi--file-document-outline]"}
				onOpenFile={() => {}}
				onOpenUrl={() => {}}
			/>
		</div>
	</div>,
);
