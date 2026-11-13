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

const NUMERIC_REGEX = /^\d$/u;
const ALPHA_REGEX = /^[a-zA-Z]$/u;
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]$/u;

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

function buildDigits(value: string, numInputs: number): string[] {
	return Array.from({ length: numInputs }, (_, index) => value[index] ?? "");
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
	const [digits, setDigits] = useState<string[]>(() =>
		buildDigits(value, numInputs)
	);
	const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
	const digitsRef = useRef<string[]>(digits);
	const lastEmittedValueRef = useRef(value);
	const lastCompletedRef = useRef("");

	digitsRef.current = digits;

	// Sync internal slot array only when external `value` changes out-of-band
	useEffect(() => {
		if (
			value === lastEmittedValueRef.current &&
			digitsRef.current.length === numInputs
		) {
			return;
		}
		lastEmittedValueRef.current = value;
		if (value.length < numInputs) {
			lastCompletedRef.current = "";
		}
		setDigits(buildDigits(value, numInputs));
	}, [value, numInputs]);

	useEffect(() => {
		inputRefs.current = inputRefs.current.slice(0, numInputs);
	}, [numInputs]);

	useEffect(() => {
		if (shouldAutoFocus && !disabled) {
			const timer = setTimeout(() => {
				inputRefs.current[0]?.focus();
			}, 0);
			return () => clearTimeout(timer);
		}
	}, [shouldAutoFocus, disabled]);

	// Fire onComplete once per newly completed OTP code without re-triggering on unrelated rerenders
	useEffect(() => {
		const isComplete =
			digits.length === numInputs &&
			digits.every((digit) => digit.length === 1);
		if (!isComplete) {
			lastCompletedRef.current = "";
			return;
		}

		const joined = digits.join("");
		if (onComplete && lastCompletedRef.current !== joined) {
			lastCompletedRef.current = joined;
			onComplete(joined);
		}
	}, [digits, numInputs, onComplete]);

	const getPlaceholderValue = useCallback(() => {
		if (typeof placeholder === "string" && placeholder.length === numInputs) {
			return placeholder;
		}
		if (placeholder && placeholder.length !== numInputs) {
			console.warn(
				"Length of the placeholder should be equal to the number of inputs."
			);
		}
	}, [placeholder, numInputs]);

	const isInputValueValid = useCallback(
		(valueCurr: string) => {
			if (valueCurr.trim().length !== 1) {
				return false;
			}

			switch (allowedCharacterSet) {
				case "numeric":
					return (
						!Number.isNaN(Number(valueCurr)) && NUMERIC_REGEX.test(valueCurr)
					);
				case "alpha":
					return ALPHA_REGEX.test(valueCurr);
				case "alphanumeric":
					return ALPHANUMERIC_REGEX.test(valueCurr);
				default:
					return false;
			}
		},
		[allowedCharacterSet]
	);

	const focusInput = useCallback(
		(index: number) => {
			const targetIndex = Math.max(Math.min(numInputs - 1, index), 0);

			if (inputRefs.current[targetIndex] && !disabled) {
				requestAnimationFrame(() => {
					inputRefs.current[targetIndex]?.focus();
					inputRefs.current[targetIndex]?.select();
					setActiveInput(targetIndex);
				});
			}
		},
		[numInputs, disabled]
	);

	const commitDigits = useCallback(
		(nextDigits: string[]) => {
			const normalized = nextDigits.slice(0, numInputs);
			const joined = normalized.join("");
			digitsRef.current = normalized;
			lastEmittedValueRef.current = joined;
			setDigits(normalized);
			onChange(joined);
		},
		[numInputs, onChange]
	);

	const applyCharactersAt = useCallback(
		(startIndex: number, rawText: string) => {
			const validChars = rawText
				.replace(/\s/gu, "")
				.split("")
				.filter((char) => isInputValueValid(char))
				.slice(0, numInputs - startIndex);

			if (validChars.length === 0) {
				return false;
			}

			const nextDigits = [...digitsRef.current];
			for (let offset = 0; offset < validChars.length; offset += 1) {
				const char = validChars[offset];
				const position = startIndex + offset;
				if (char !== undefined && position < numInputs) {
					nextDigits[position] = char;
				}
			}

			commitDigits(nextDigits);
			focusInput(Math.min(startIndex + validChars.length, numInputs - 1));
			return true;
		},
		[commitDigits, focusInput, isInputValueValid, numInputs]
	);

	const handleChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>, index: number) => {
			if (disabled) {
				return;
			}

			const { value: inputValue } = event.target;
			if (!inputValue) {
				if (digitsRef.current[index]) {
					const nextDigits = [...digitsRef.current];
					nextDigits[index] = "";
					commitDigits(nextDigits);
				}
				return;
			}

			// Handle SMS autofill or multi-character input pasted into a single box
			if (inputValue.length > 1) {
				applyCharactersAt(index, inputValue);
				return;
			}

			if (isInputValueValid(inputValue)) {
				const nextDigits = [...digitsRef.current];
				nextDigits[index] = inputValue;
				commitDigits(nextDigits);

				if (index < numInputs - 1) {
					focusInput(index + 1);
				}
			}
		},
		[
			applyCharactersAt,
			commitDigits,
			disabled,
			focusInput,
			isInputValueValid,
			numInputs,
		]
	);

	const handleInputChange = useCallback(
		(event: React.SyntheticEvent<HTMLInputElement>, index: number) => {
			if (disabled) {
				return;
			}

			const { value: valueCur } = event.currentTarget;

			if (valueCur.length > 1) {
				applyCharactersAt(index, valueCur);
				event.currentTarget.value = digitsRef.current[index] ?? "";
				return;
			}

			const nativeEvent = event.nativeEvent as InputEvent;
			if (
				nativeEvent.inputType === "deleteContentBackward" ||
				nativeEvent.inputType === "deleteContentForward"
			) {
				event.preventDefault();
				const nextDigits = [...digitsRef.current];
				if (nextDigits[index]) {
					nextDigits[index] = "";
					commitDigits(nextDigits);
				} else if (
					index > 0 &&
					nativeEvent.inputType === "deleteContentBackward"
				) {
					nextDigits[index - 1] = "";
					commitDigits(nextDigits);
					focusInput(index - 1);
				}
				return;
			}

			if (valueCur && !isInputValueValid(valueCur)) {
				event.currentTarget.value = digitsRef.current[index] ?? "";
			}
		},
		[applyCharactersAt, commitDigits, disabled, focusInput, isInputValueValid]
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

			const { key } = event;
			const nextDigits = [...digitsRef.current];

			switch (key) {
				case "Backspace":
				case "Delete":
					event.preventDefault();
					if (nextDigits[index]) {
						nextDigits[index] = "";
						commitDigits(nextDigits);
					} else if (index > 0 && key === "Backspace") {
						nextDigits[index - 1] = "";
						commitDigits(nextDigits);
						focusInput(index - 1);
					}
					break;

				case "ArrowLeft":
					event.preventDefault();
					focusInput(index - 1);
					break;

				case "ArrowRight":
					event.preventDefault();
					focusInput(index + 1);
					break;

				case "Home":
					event.preventDefault();
					focusInput(0);
					break;

				case "End":
					event.preventDefault();
					focusInput(numInputs - 1);
					break;

				default:
					if (key.length === 1 && isInputValueValid(key)) {
						event.preventDefault();
						nextDigits[index] = key;
						commitDigits(nextDigits);
						if (index < numInputs - 1) {
							focusInput(index + 1);
						}
					}
					break;
			}
		},
		[commitDigits, disabled, focusInput, isInputValueValid, numInputs]
	);

	const handlePaste = useCallback(
		(event: ClipboardEvent<HTMLInputElement>, index: number) => {
			if (disabled) {
				return;
			}

			event.preventDefault();
			const startAt =
				event.clipboardData.getData("text/plain").replace(/\s/gu, "").length >=
				numInputs
					? 0
					: index;
			applyCharactersAt(startAt, event.clipboardData.getData("text/plain"));
		},
		[applyCharactersAt, disabled, numInputs]
	);

	const resolvedPlaceholder = getPlaceholderValue();

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
			{Array.from({ length: numInputs }, (_, index) => index).map((index) => {
				const digit = digits[index] ?? "";
				return (
					<React.Fragment key={index}>
						{renderInput(
							{
								value: isSecure && digit ? "•" : digit,
								placeholder: resolvedPlaceholder?.[index] ?? undefined,
								ref: (element) => {
									if (element !== null) {
										inputRefs.current[index] = element;
									}
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
								inputMode:
									allowedCharacterSet === "numeric" ||
									inputType === "number" ||
									inputType === "tel"
										? "numeric"
										: "text",
								onInput: (event) => handleInputChange(event, index),
								disabled,
							},
							index
						)}
						{(() => {
							if (index >= numInputs - 1) {
								return null;
							}
							if (
								renderMiddleSeparator &&
								index === Math.floor(numInputs / 2) - 1
							) {
								return <FakeDash />;
							}
							return typeof renderSeparator === "function"
								? renderSeparator(index)
								: renderSeparator;
						})()}
					</React.Fragment>
				);
			})}
		</fieldset>
	);
};

export type { AllowedInputTypes, InputProps, OTPInputProps };
export default OTPInput;
