const HTML_ESCAPE_MAP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
	"`": "&#96;",
};

const HTML_ESCAPE_REGEX = /[&<>"'`]/gu;

export function escapeHtml(value: string): string {
	return value.replace(
		HTML_ESCAPE_REGEX,
		(char) => HTML_ESCAPE_MAP[char] ?? char
	);
}

export function sanitizeHttpUrl(
	rawUrl: unknown,
	fallback = "#"
): { href: string; rawText: string } {
	if (typeof rawUrl !== "string" || !rawUrl.trim()) {
		return { href: fallback, rawText: fallback };
	}

	try {
		const parsed = new URL(rawUrl.trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return { href: fallback, rawText: fallback };
		}
		const normalized = parsed.toString();
		return { href: escapeHtml(normalized), rawText: normalized };
	} catch {
		return { href: fallback, rawText: fallback };
	}
}

export function renderEmailLayout(bodyHtml: string): string {
	return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; border-radius: 8px;">${bodyHtml}</div>`;
}

export function renderPrimaryButton(href: string, label: string): string {
	return `<div style="margin: 24px 0;"><a href="${href}" style="display: inline-block; background-color: #09090b; color: #fafafa; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px;">${label}</a></div>`;
}
