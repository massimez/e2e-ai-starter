import type { MetadataRoute } from "next";
import { publicWebEnv } from "@/env";

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{
			changeFrequency: "weekly",
			lastModified: new Date(),
			priority: 1,
			url: new URL("/", publicWebEnv.appUrl).toString(),
		},
	];
}
