import path from "node:path";
import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

const withBundleAnalyzer = bundleAnalyzer({
	enabled: process.env.ANALYZE === "true",
});

const isProduction = process.env.NODE_ENV === "production";

const extraRemotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] =
	[];
for (const candidate of [process.env.S3_PUBLIC_URL, process.env.S3_ENDPOINT]) {
	if (candidate) {
		try {
			const parsed = new URL(candidate);
			if (parsed.protocol === "http:" || parsed.protocol === "https:") {
				extraRemotePatterns.push({
					hostname: parsed.hostname,
					port: parsed.port || undefined,
					protocol: parsed.protocol.slice(0, -1) as "http" | "https",
				});
			}
		} catch {
			// Ignore malformed optional image domain
		}
	}
}

const nextConfig: NextConfig = {
	output: "standalone",
	outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
	trailingSlash: false,
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			...extraRemotePatterns,
		],
	},
	async rewrites() {
		const apiUrl =
			process.env.INTERNAL_API_URL ||
			process.env.NEXT_PUBLIC_API_URL ||
			"http://localhost:3001";
		return [
			{
				source: "/api/:path*",
				destination: `${apiUrl}/api/:path*`,
			},
		];
	},
	async headers() {
		const securityHeaders = [
			{
				key: "Permissions-Policy",
				value: "camera=(), microphone=(), geolocation=()",
			},
			{
				key: "Referrer-Policy",
				value: "strict-origin-when-cross-origin",
			},
			{
				key: "X-Content-Type-Options",
				value: "nosniff",
			},
			{
				key: "X-Frame-Options",
				value: "DENY",
			},
			{
				key: "X-XSS-Protection",
				value: "0",
			},
		];

		if (isProduction) {
			securityHeaders.push({
				key: "Strict-Transport-Security",
				value: "max-age=31536000; includeSubDomains",
			});
		}

		return [
			{
				source: "/(.*)",
				headers: securityHeaders,
			},
		];
	},
};

export default withBundleAnalyzer(nextConfig);
