import type { MetadataRoute } from "next";
import { publicWebEnv } from "@/env";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			allow: "/",
			disallow: ["/dashboard/", "/api/"],
			userAgent: "*",
		},
		sitemap: `${publicWebEnv.appUrl}/sitemap.xml`,
	};
}
