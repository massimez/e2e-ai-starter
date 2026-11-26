"use client";

import { useEffect, useState } from "react";

/**
 * Delays updating the returned value until `delayMs` has elapsed since the last change.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebounced(value);
		}, delayMs);
		return () => clearTimeout(timer);
	}, [delayMs, value]);

	return debounced;
}
