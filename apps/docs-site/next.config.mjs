import { createMDX } from "fumadocs-mdx/next";

/** @type {import("next").NextConfig} */
const config = {
	reactStrictMode: true,
	trailingSlash: true,
	async rewrites() {
		return [{ source: "/:path*.md", destination: "/llms.mdx/:path*" }];
	},
};

export default createMDX()(config);
