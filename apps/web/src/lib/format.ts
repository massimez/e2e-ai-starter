const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeZone: "UTC",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

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

/**
 * Formats an ISO string or Date in local date + short time format.
 */
export function formatDateTime(value: string | Date, fallback = "—"): string {
	const parsed = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return fallback;
	}
	return DATE_TIME_FORMATTER.format(parsed);
}

/**
 * Formats a non-negative byte count into a human-readable string (e.g. `1.5 GB`).
 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B";
	}
	let unitIndex = 0;
	let value = bytes;
	while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const precision = unitIndex === 0 || value >= 100 ? 0 : 1;
	return `${value.toFixed(precision)} ${BYTE_UNITS[unitIndex] ?? "B"}`;
}
