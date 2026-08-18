import { buildRobotsConfig } from "@/lib/seo/robots";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return buildRobotsConfig();
}
