"use client";

import { cn } from "@workspace/ui/lib/utils";
import type {
	ChangeEvent,
	ClipboardEvent,
	FocusEvent,
	KeyboardEvent,
} from "react";
import React, { useCallback, useEffect, useRef, useState } from "react";

type AllowedInputTypes = "password" | "text" | "number" | "tel";

const CHAR_PATTERNS = {
	alpha: /^[a-zA-Z]$/u,
	alphanumeric: /^[a-zA-Z0-9]$/u,
	numeric: /^\d$/u,
} as const;

type InputProps = Required<
	Pick<
		React.InputHTMLAttributes<HTMLInputElement>,
		| "value"
		| "onChange"
		| "onFocus"
		| "onBlur"
		| "onKeyDown"
		| "onPaste"
		| "aria-label"
		| "autoComplete"
		| "style"
		| "inputMode"
		| "onInput"
		| "disabled"
	> & {
		ref: React.RefCallback<HTMLInputElement>;
		placeholder: string | undefined;
		className: string | undefined;
		type: AllowedInputTypes;
	}
>;

function FakeDash() {
	return (
		<div className="flex w-6 items-center justify-center">
			<div className="bg-border h-1 w-3 rounded-full" />
		</div>
	);
}

interface OTPInputProps {
	allowedCharacterSet?: "numeric" | "alphanumeric" | "alpha";
	containerStyle?: React.CSSProperties | string;
	disabled?: boolean;
	inputStyle?: React.CSSProperties | string;
	inputType?: AllowedInputTypes;
	isSecure?: boolean;
	numInputs?: number;
	onChange: (otp: string) => void;
	onComplete?: (otp: string) => void;
	onPaste?: (event: ClipboardEvent<HTMLFieldSetElement>) => void;
	placeholder?: string;
	renderInput: (inputProps: InputProps, index: number) => React.ReactNode;
	renderMiddleSeparator?: boolean;
	renderSeparator?: ((index: number) => React.ReactNode) | React.ReactNode;
	shouldAutoFocus?: boolean;
	skipDefaultStyles?: boolean;
	value?: string;
}

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

function resolveNavTarget(
	key: string,
	index: number,
	numInputs: number
): number {
	switch (key) {
		case "ArrowLeft":
			return index - 1;
		case "ArrowRight":
			return index + 1;
		case "Home":
			return 0;
		default:
			return numInputs - 1;
	}
}

type OtpKeyPlan =
	| { focusIndex: number; nextDigits?: string[]; type: "update" }
	| { type: "noop" };

function computeOtpKeyPlan(params: {
	digits: string[];
	index: number;
	isCharValid: (char: string) => boolean;
	key: string;
	numInputs: number;
}): OtpKeyPlan {
	const { digits, index, isCharValid, key, numInputs } = params;
	if (NAV_KEYS.has(key)) {
		return {
			focusIndex: resolveNavTarget(key, index, numInputs),
			type: "update",
		};
	}

	if (key === "Backspace" || key === "Delete") {
		const nextDigits = [...digits];
		if (nextDigits[index]) {
			nextDigits[index] = "";
			return { focusIndex: index, nextDigits, type: "update" };
		}
		if (key === "Backspace" && index > 0) {
			nextDigits[index - 1] = "";
			return { focusIndex: index - 1, nextDigits, type: "update" };
		}
		return { type: "noop" };
	}

	if (isCharValid(key)) {
		const nextDigits = [...digits];
		nextDigits[index] = key;
		return {
			focusIndex: index < numInputs - 1 ? index + 1 : index,
			nextDigits,
			type: "update",
		};
	}

	return { type: "noop" };
}

function resolveSeparator(
	index: number,
	numInputs: number,
	renderMiddleSeparator: boolean,
	renderSeparator: OTPInputProps["renderSeparator"]
): React.ReactNode {
	if (index >= numInputs - 1) {
		return null;
	}
	if (renderMiddleSeparator && index === Math.floor(numInputs / 2) - 1) {
		return <FakeDash />;
	}
	return typeof renderSeparator === "function"
		? renderSeparator(index)
		: renderSeparator;
}

const OTPInput = ({
	value = "",
	numInputs = 4,
	onChange,
	onComplete,
	onPaste,
	renderInput,
	shouldAutoFocus = false,
	inputType = "text",
	renderSeparator,
	placeholder,
	containerStyle,
	inputStyle,
	disabled = false,
	isSecure = false,
	allowedCharacterSet = "numeric",
	renderMiddleSeparator = false,
}: OTPInputProps) => {
	const [activeInput, setActiveInput] = useState(0);
	const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
	const digits = Array.from({ length: numInputs }, (_, i) => value[i] ?? "");

	useEffect(() => {
		inputRefs.current = inputRefs.current.slice(0, numInputs);
	}, [numInputs]);

	useEffect(() => {
		if (!shouldAutoFocus || disabled) {
			return;
		}
		const timer = setTimeout(() => {
			inputRefs.current[0]?.focus();
		}, 0);
		return () => clearTimeout(timer);
	}, [shouldAutoFocus, disabled]);

	const isCharValid = useCallback(
		(char: string) =>
			char.length === 1 && CHAR_PATTERNS[allowedCharacterSet].test(char),
		[allowedCharacterSet]
	);

	const focusSlot = useCallback(
		(index: number) => {
			if (disabled) {
				return;
			}
			const clamped = Math.max(0, Math.min(numInputs - 1, index));
			requestAnimationFrame(() => {
				const el = inputRefs.current[clamped];
				if (el) {
					el.focus();
					el.select();
					setActiveInput(clamped);
				}
			});
		},
		[disabled, numInputs]
	);

	const commitDigits = useCallback(
		(nextDigits: string[]) => {
			const normalized = nextDigits.slice(0, numInputs);
			const joined = normalized.join("");
			onChange(joined);
			if (
				onComplete &&
				normalized.length === numInputs &&
				normalized.every((d) => d.length === 1)
			) {
				onComplete(joined);
			}
		},
		[numInputs, onChange, onComplete]
	);

	const applyCharactersAt = useCallback(
		(startIndex: number, rawText: string) => {
			const chars = rawText
				.replace(/\s/gu, "")
				.split("")
				.filter(isCharValid)
				.slice(0, numInputs - startIndex);

			if (chars.length === 0) {
				return;
			}

			const nextDigits = [...digits];
			for (const [offset, char] of chars.entries()) {
				nextDigits[startIndex + offset] = char;
			}
			commitDigits(nextDigits);
			focusSlot(Math.min(startIndex + chars.length, numInputs - 1));
		},
		[commitDigits, digits, focusSlot, isCharValid, numInputs]
	);

	const handleChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>, index: number) => {
			if (disabled) {
				return;
			}
			const incoming = event.target.value;
			if (!incoming) {
				if (digits[index]) {
					const nextDigits = [...digits];
					nextDigits[index] = "";
					commitDigits(nextDigits);
				}
				return;
			}

			if (incoming.length > 1) {
				applyCharactersAt(index, incoming);
				return;
			}

			if (isCharValid(incoming)) {
				const nextDigits = [...digits];
				nextDigits[index] = incoming;
				commitDigits(nextDigits);
				if (index < numInputs - 1) {
					focusSlot(index + 1);
				}
			}
		},
		[
			applyCharactersAt,
			commitDigits,
			digits,
			disabled,
			focusSlot,
			isCharValid,
			numInputs,
		]
	);

	const handleInput = useCallback(
		(event: React.SyntheticEvent<HTMLInputElement>, index: number) => {
			if (disabled) {
				return;
			}
			const currentValue = event.currentTarget.value;
			if (currentValue.length === 1 && !isCharValid(currentValue)) {
				event.currentTarget.value = digits[index] ?? "";
			}
		},
		[digits, disabled, isCharValid]
	);

	const handleFocus = useCallback(
		(event: FocusEvent<HTMLInputElement>, index: number) => {
			if (disabled) {
				return;
			}
			setActiveInput(index);
			event.target.select();
		},
		[disabled]
	);

	const handleBlur = useCallback(() => {
		// Retain last focused slot index for programmatic interactions
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>, index: number) => {
			if (disabled) {
				return;
			}
			const plan = computeOtpKeyPlan({
				digits,
				index,
				isCharValid,
				key: event.key,
				numInputs,
			});
			if (plan.type === "noop") {
				return;
			}
			event.preventDefault();
			if (plan.nextDigits) {
				commitDigits(plan.nextDigits);
			}
			if (plan.focusIndex !== index || !plan.nextDigits) {
				focusSlot(plan.focusIndex);
			}
		},
		[commitDigits, digits, disabled, focusSlot, isCharValid, numInputs]
	);

	const handlePaste = useCallback(
		(event: ClipboardEvent<HTMLInputElement>, index: number) => {
			if (disabled) {
				return;
			}
			event.preventDefault();
			const pasted = event.clipboardData.getData("text/plain");
			const startAt =
				pasted.replace(/\s/gu, "").length >= numInputs ? 0 : index;
			applyCharactersAt(startAt, pasted);
		},
		[applyCharactersAt, disabled, numInputs]
	);

	const validPlaceholder =
		typeof placeholder === "string" && placeholder.length === numInputs
			? placeholder
			: undefined;

	const slots = Array.from({ length: numInputs }, (_, index) => index);

	return (
		<fieldset
			aria-label="OTP Input"
			className={cn(
				"flex items-center",
				typeof containerStyle === "string" && containerStyle,
				disabled && "pointer-events-none opacity-50"
			)}
			data-active-input={activeInput}
			onPaste={onPaste}
			style={{ ...(typeof containerStyle === "object" && containerStyle) }}
		>
			{slots.map((index) => {
				const digit = digits[index] ?? "";
				const inputMode =
					allowedCharacterSet === "numeric" ||
					inputType === "number" ||
					inputType === "tel"
						? "numeric"
						: "text";

				return (
					<React.Fragment key={index}>
						{renderInput(
							{
								value: isSecure && digit ? "•" : digit,
								placeholder: validPlaceholder?.[index] ?? undefined,
								ref: (element) => {
									inputRefs.current[index] = element;
								},
								onChange: (event) => handleChange(event, index),
								onFocus: (event) => handleFocus(event, index),
								onBlur: handleBlur,
								onKeyDown: (event) => handleKeyDown(event, index),
								onPaste: (event) => handlePaste(event, index),
								autoComplete: index === 0 ? "one-time-code" : "off",
								"aria-label": `OTP input ${index + 1} of ${numInputs}`,
								style: {
									textAlign: "center",
									...(typeof inputStyle === "object" && inputStyle),
								},
								className: cn(
									typeof inputStyle === "string" ? inputStyle : undefined,
									disabled && "cursor-not-allowed"
								),
								type: inputType,
								inputMode,
								onInput: (event) => handleInput(event, index),
								disabled,
							},
							index
						)}
						{resolveSeparator(
							index,
							numInputs,
							renderMiddleSeparator,
							renderSeparator
						)}
					</React.Fragment>
				);
			})}
		</fieldset>
	);
};

export type { AllowedInputTypes, InputProps, OTPInputProps };
export default OTPInput;
