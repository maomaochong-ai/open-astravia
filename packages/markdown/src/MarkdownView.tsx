import Markdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { MarkdownAnchor } from "./components/MarkdownAnchor";
import { MarkdownImage } from "./components/MarkdownImage";
import { MarkdownTable } from "./components/MarkdownTable";

export type MarkdownViewProps = {
	content: string;
	/** 追加到根容器的 class，用于控制外边距/最大宽度，排版本身由 markdown.css 负责。 */
	className?: string;
	/**
	 * 把正文里的图片地址映射成当前宿主可访问的地址。
	 * 正文存的是与后端同源的相对路径（/api/v1/blog/assets/...）：site 用 rewrite 转发，
	 * 直接可用；admin 开发态 API 在另一个 origin，需要靠这个钩子补上前缀。
	 */
	transformImageSrc?: (src: string) => string;
};

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

const COMPONENTS = {
	a: MarkdownAnchor,
	img: MarkdownImage,
	table: MarkdownTable,
};

/**
 * 博客正文渲染器。admin 编辑预览与 site 公众页共用，保证「所见即所得」。
 * 不开启 rehype-raw：正文来自后台编辑，但仍按不可信内容处理，禁止内联 HTML。
 */
export function MarkdownView({ content, className, transformImageSrc }: MarkdownViewProps) {
	const urlTransform = (url: string, key: string) => {
		const safe = defaultUrlTransform(url);
		if (!safe || key !== "src" || !transformImageSrc) return safe;
		return transformImageSrc(safe);
	};

	return (
		<div className={className ? `astravia-markdown ${className}` : "astravia-markdown"}>
			<Markdown
				remarkPlugins={REMARK_PLUGINS}
				rehypePlugins={REHYPE_PLUGINS}
				components={COMPONENTS}
				urlTransform={urlTransform}
			>
				{content}
			</Markdown>
		</div>
	);
}
