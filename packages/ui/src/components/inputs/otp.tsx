"use client";

import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import {
	type ChangeEvent,
	type ClipboardEvent,
	Fragment,
	type KeyboardEvent,
	useEffect,
	useRef,
} from "react";

const DIGIT_REGEX = /^\d$/u;

export interface OTPInputProps {
	"aria-describedby"?: string;
	"aria-invalid"?: boolean;
	className?: string;
	disabled?: boolean;
	inputClassName?: string;
	numInputs?: number;
	onChange: (otp: string) => void;
	onComplete?: (otp: string) => void;
	renderMiddleSeparator?: boolean;
	shouldAutoFocus?: boolean;
	value?: string;
}

function resolveNavTarget(
	key: string,
	index: number,
	numInputs: number
): number | null {
	switch (key) {
		case "ArrowLeft":
			return index - 1;
		case "ArrowRight":
			return index + 1;
		case "Home":
			return 0;
		case "End":
			return numInputs - 1;
		default:
			return null;
	}
}

export default function OTPInput({
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	className,
	disabled = false,
	inputClassName,
	numInputs = 6,
	onChange,
	onComplete,
	renderMiddleSeparator = false,
	shouldAutoFocus = false,
	value = "",
}: OTPInputProps) {
	const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
	const slots = Array.from({ length: numInputs }, (_, slot) => slot);
	const digits = slots.map((slot) => value[slot] ?? "");

	useEffect(() => {
		inputRefs.current = inputRefs.current.slice(0, numInputs);
	}, [numInputs]);

	useEffect(() => {
		if (!shouldAutoFocus || disabled) {
			return;
		}
		const timer = setTimeout(() => inputRefs.current[0]?.focus(), 0);
		return () => clearTimeout(timer);
	}, [shouldAutoFocus, disabled]);

	const focusSlot = (index: number) => {
		if (disabled) {
			return;
		}
		const clamped = Math.max(0, Math.min(numInputs - 1, index));
		requestAnimationFrame(() => {
			const el = inputRefs.current[clamped];
			if (el) {
				el.focus();
				el.select();
			}
		});
	};

	const commitDigits = (nextDigits: string[]) => {
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
	};

	const applyCharactersAt = (startIndex: number, rawText: string) => {
		const chars = rawText
			.replace(/\s/gu, "")
			.split("")
			.filter((ch) => DIGIT_REGEX.test(ch))
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
	};

	const handleChange = (
		event: ChangeEvent<HTMLInputElement>,
		index: number
	) => {
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
		if (DIGIT_REGEX.test(incoming)) {
			const nextDigits = [...digits];
			nextDigits[index] = incoming;
			commitDigits(nextDigits);
			if (index < numInputs - 1) {
				focusSlot(index + 1);
			}
		}
	};

	const handleDeleteKey = (key: string, index: number) => {
		const nextDigits = [...digits];
		if (nextDigits[index]) {
			nextDigits[index] = "";
			commitDigits(nextDigits);
			return;
		}
		if (key === "Backspace" && index > 0) {
			nextDigits[index - 1] = "";
			commitDigits(nextDigits);
			focusSlot(index - 1);
		}
	};

	const handleKeyDown = (
		event: KeyboardEvent<HTMLInputElement>,
		index: number
	) => {
		if (disabled) {
			return;
		}
		const navTarget = resolveNavTarget(event.key, index, numInputs);
		if (navTarget !== null) {
			event.preventDefault();
			focusSlot(navTarget);
			return;
		}
		if (event.key === "Backspace" || event.key === "Delete") {
			event.preventDefault();
			handleDeleteKey(event.key, index);
			return;
		}
		if (DIGIT_REGEX.test(event.key)) {
			event.preventDefault();
			const nextDigits = [...digits];
			nextDigits[index] = event.key;
			commitDigits(nextDigits);
			if (index < numInputs - 1) {
				focusSlot(index + 1);
			}
		}
	};

	const handlePaste = (
		event: ClipboardEvent<HTMLInputElement>,
		index: number
	) => {
		if (disabled) {
			return;
		}
		event.preventDefault();
		const pasted = event.clipboardData.getData("text/plain");
		const startAt = pasted.replace(/\s/gu, "").length >= numInputs ? 0 : index;
		applyCharactersAt(startAt, pasted);
	};

	const middleIndex = Math.floor(numInputs / 2) - 1;

	return (
		<fieldset
			aria-label="OTP Input"
			className={cn(
				"flex items-center gap-1.5",
				disabled && "pointer-events-none opacity-50",
				className
			)}
		>
			{slots.map((slotIndex) => (
				<Fragment key={slotIndex}>
					<Input
						aria-describedby={ariaDescribedBy}
						aria-invalid={ariaInvalid}
						aria-label={`OTP input ${slotIndex + 1} of ${numInputs}`}
						autoComplete={slotIndex === 0 ? "one-time-code" : "off"}
						className={cn(
							"text-center",
							disabled && "cursor-not-allowed",
							inputClassName
						)}
						disabled={disabled}
						inputMode="numeric"
						onChange={(event) => handleChange(event, slotIndex)}
						onFocus={(event) => event.target.select()}
						onKeyDown={(event) => handleKeyDown(event, slotIndex)}
						onPaste={(event) => handlePaste(event, slotIndex)}
						ref={(el) => {
							inputRefs.current[slotIndex] = el;
						}}
						type="text"
						value={digits[slotIndex] ?? ""}
					/>
					{renderMiddleSeparator && slotIndex === middleIndex ? (
						<div
							aria-hidden="true"
							className="flex w-6 items-center justify-center"
						>
							<div className="bg-border h-1 w-3 rounded-full" />
						</div>
					) : null}
				</Fragment>
			))}
		</fieldset>
	);
}
