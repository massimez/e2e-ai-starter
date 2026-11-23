const devicePatterns: ReadonlyArray<{
	browser?: string;
	os?: string;
	pattern: RegExp;
	type?: "mobile" | "tablet";
}> = [
	{ pattern: /Edg(?:e|A|iOS)?\//iu, browser: "Edge" },
	{ pattern: /SamsungBrowser\//iu, browser: "Samsung Internet" },
	{ pattern: /(?:OPR|OPiOS)\//iu, browser: "Opera" },
	{ pattern: /(?:Firefox|FxiOS)\//iu, browser: "Firefox" },
	{ pattern: /(?:Chrome|CriOS|Chromium)\//iu, browser: "Chrome" },
	{ pattern: /Safari\//iu, browser: "Safari" },
	{ pattern: /iPad|Macintosh.*Mobile/iu, os: "iPad", type: "tablet" },
	{ pattern: /iPhone|iPod/iu, os: "iPhone", type: "mobile" },
	{ pattern: /Android/iu, os: "Android" },
	{ pattern: /Windows/iu, os: "Windows" },
	{ pattern: /CrOS/iu, os: "ChromeOS" },
	{ pattern: /Macintosh|Mac OS X/iu, os: "macOS" },
	{ pattern: /Linux/iu, os: "Linux" },
	{ pattern: /Tablet|Kindle|Silk\//iu, type: "tablet" },
	{ pattern: /Mobile/iu, type: "mobile" },
];

export function parseSessionDevice(userAgent?: string | null) {
	const ua = userAgent ?? "";
	const matches = devicePatterns.filter(({ pattern }) => pattern.test(ua));
	const browser = matches.find((match) => match.browser)?.browser;
	const os = matches.find((match) => match.os)?.os;
	const type =
		matches.find((match) => match.type)?.type ??
		((os === "Android" ? "tablet" : "desktop") as
			| "desktop"
			| "mobile"
			| "tablet");
	return {
		browser,
		os,
		type,
		label: [browser, os].filter(Boolean).join(" on ") || "Unknown device",
	};
}
