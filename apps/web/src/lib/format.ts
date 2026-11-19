const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeZone: "UTC",
});

/**
 * Formats an ISO string or Date in UTC (`MMM D, YYYY`), returning `fallback` on invalid dates.
 */
export function formatUtcDate(
	value: string | Date,
	fallback = "Unknown date"
): string {
	const parsed = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return fallback;
	}
	return UTC_DATE_FORMATTER.format(parsed);
}
