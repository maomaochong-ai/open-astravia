import { createMDX } from "fumadocs-mdx/next";

/** @type {import("next").NextConfig} */
const config = {
	reactStrictMode: true,
	trailingSlash: true,
};

export default createMDX()(config);
