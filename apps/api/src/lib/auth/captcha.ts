import { captcha } from "better-auth/plugins";

export const CAPTCHA_PROTECTED_ENDPOINTS = [
	"/sign-up/email",
	"/sign-in/email",
	"/forget-password/email-otp",
	"/email-otp/request-password-reset",
	"/request-password-reset",
	"/email-otp/send-verification-otp",
] as const;

export interface CreateAuthCaptchaPluginOptions {
	allowedHostnames?: string[];
	endpoints?: readonly string[];
	secretKey?: string;
	siteVerifyURLOverride?: string;
}

/**
 * Builds the Better Auth Cloudflare Turnstile plugin when a secret key is configured.
 * Returns `null` when disabled so local development and test suites run without keys.
 */
export function createAuthCaptchaPlugin(
	options: CreateAuthCaptchaPluginOptions
) {
	const secretKey = options.secretKey?.trim();
	if (!secretKey) {
		return null;
	}

	const allowedHostnames = options.allowedHostnames
		?.map((hostname) => hostname.trim())
		.filter(Boolean);

	return captcha({
		provider: "cloudflare-turnstile",
		secretKey,
		endpoints: [...(options.endpoints ?? CAPTCHA_PROTECTED_ENDPOINTS)],
		...(allowedHostnames && allowedHostnames.length > 0
			? { allowedHostnames }
			: {}),
		...(options.siteVerifyURLOverride
			? { siteVerifyURLOverride: options.siteVerifyURLOverride }
			: {}),
	});
}
