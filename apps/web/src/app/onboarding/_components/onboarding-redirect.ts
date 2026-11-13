/**
 * Restricts post-onboarding redirects strictly to internal dashboard routes.
 */
export function resolveSafeOnboardingRedirect(
	nextParam: string | string[] | undefined | null
): string {
	const candidate = Array.isArray(nextParam) ? nextParam[0] : nextParam;
	if (!candidate) {
		return "/dashboard";
	}

	const trimmed = candidate.trim();
	if (
		!trimmed.startsWith("/dashboard") ||
		trimmed.startsWith("//") ||
		trimmed.includes("\\")
	) {
		return "/dashboard";
	}

	return trimmed;
}
