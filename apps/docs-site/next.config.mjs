import { createMDX } from "fumadocs-mdx/next";

/** @type {import("next").NextConfig} */
const securityHeaders = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "X-Frame-Options", value: "SAMEORIGIN" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config = {
	reactStrictMode: true,
	trailingSlash: true,
	async headers() {
		return [{ source: "/:path*", headers: securityHeaders }];
	},
	async rewrites() {
		return [{ source: "/:path*.md", destination: "/llms.mdx/:path*" }];
	},
};

export default createMDX()(config);
