import { getGitLastModified } from "@/lib/seo/last-modified";
import { buildSitemapEntries } from "@/lib/seo/sitemap";
import { source } from "@/lib/source";
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	const pages = source.getPages("zh").map((page) => ({
		path: page.url,
		lastModified: page.absolutePath ? getGitLastModified(page.absolutePath) : undefined,
	}));

	return buildSitemapEntries(pages);
}
