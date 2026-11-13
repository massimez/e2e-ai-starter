import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

const withBundleAnalyzer = bundleAnalyzer({
	enabled: process.env.ANALYZE === "true",
});

function extractOrigin(rawUrl: string | undefined): string | null {
	if (!rawUrl) {
		return null;
	}
	try {
		return new URL(rawUrl).origin;
	} catch {
		return null;
	}
}

function buildContentSecurityPolicy(prodEnv: boolean): string {
	const connectSources = new Set<string>(["'self'"]);
	const imageSources = new Set<string>([
		"'self'",
		"data:",
		"blob:",
		"https://lh3.googleusercontent.com",
	]);

	for (const candidate of [
		process.env.NEXT_PUBLIC_API_URL,
		process.env.NEXT_PUBLIC_STORAGE_ORIGIN,
		process.env.S3_ENDPOINT,
		process.env.S3_PUBLIC_URL,
	]) {
		const origin = extractOrigin(candidate);
		if (origin) {
			connectSources.add(origin);
			imageSources.add(origin);
		}
	}

	if (!prodEnv) {
		connectSources.add("http://localhost:3001");
		connectSources.add("http://localhost:9000");
		connectSources.add("http://127.0.0.1:9000");
		imageSources.add("http://localhost:9000");
		imageSources.add("http://127.0.0.1:9000");
	}

	const scriptDirectives = prodEnv
		? "'self' 'unsafe-inline'"
		: "'self' 'unsafe-inline' 'unsafe-eval'";

	return [
		"default-src 'self'",
		`script-src ${scriptDirectives}`,
		"style-src 'self' 'unsafe-inline'",
		`img-src ${Array.from(imageSources).join(" ")}`,
		"font-src 'self' data:",
		`connect-src ${Array.from(connectSources).join(" ")}`,
		"worker-src 'self'",
		"manifest-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");
}

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
				key: "Content-Security-Policy",
				value: buildContentSecurityPolicy(isProduction),
			},
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
