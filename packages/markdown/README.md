# @vetta/markdown

博客正文的共享 Markdown 渲染器。`apps/admin` 的编辑预览与 `apps/site` 的公众页共用同一份实现与样式，保证后台看到的效果就是线上效果。

源码包，不产出 `dist/`：消费方直接引用 `src/`（Next 侧需要在 `transpilePackages` 里声明）。

## 用法

```tsx
import { MarkdownView } from "@vetta/markdown";
import "@vetta/markdown/markdown.css";

<MarkdownView content={post.content} />;
```

样式全部挂在 `.vetta-markdown` 下，颜色取宿主的 shadcn 主题变量（`--foreground` / `--border` / `--primary` / `--muted` …），亮暗主题自动跟随，无需额外配置。

### transformImageSrc

正文里的图片存的是与后端同源的相对路径（`/api/v1/blog/assets/...`）。site 通过 `next.config.ts` 的 rewrite 转发，直接可用；admin 开发态 API 在另一个 origin，需要补前缀：

```tsx
<MarkdownView content={value} transformImageSrc={(src) => resolveApiUrl(src)} />
```

## 安全

不启用 `rehype-raw`。正文虽然来自后台，仍按不可信内容处理，内联 HTML 一律不渲染。
