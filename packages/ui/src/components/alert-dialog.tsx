"use client";

import {
	Action,
	Cancel,
	Content,
	Description,
	Overlay,
	Portal,
	Root,
	Title,
	Trigger,
} from "@radix-ui/react-alert-dialog";
import { buttonVariants } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

function AlertDialog({ ...props }: ComponentProps<typeof Root>) {
	return <Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({ ...props }: ComponentProps<typeof Trigger>) {
	return <Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ ...props }: ComponentProps<typeof Portal>) {
	return <Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
	className,
	...props
}: ComponentProps<typeof Overlay>) {
	return (
		<Overlay
			className={cn(
				"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in fixed inset-0 z-50 bg-black/50",
				className
			)}
			data-slot="alert-dialog-overlay"
			{...props}
		/>
	);
}

function AlertDialogContent({
	className,
	...props
}: ComponentProps<typeof Content>) {
	return (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			<Content
				className={cn(
					"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 bg-background data-[state=closed]:animate-out data-[state=open]:animate-in fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
					className
				)}
				data-slot="alert-dialog-content"
				{...props}
			/>
		</AlertDialogPortal>
	);
}

function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
			data-slot="alert-dialog-header"
			{...props}
		/>
	);
}

function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
				className
			)}
			data-slot="alert-dialog-footer"
			{...props}
		/>
	);
}

function AlertDialogTitle({
	className,
	...props
}: ComponentProps<typeof Title>) {
	return (
		<Title
			className={cn("text-lg font-semibold", className)}
			data-slot="alert-dialog-title"
			{...props}
		/>
	);
}

function AlertDialogDescription({
	className,
	...props
}: ComponentProps<typeof Description>) {
	return (
		<Description
			className={cn("text-muted-foreground text-sm", className)}
			data-slot="alert-dialog-description"
			{...props}
		/>
	);
}

function AlertDialogAction({
	className,
	...props
}: ComponentProps<typeof Action>) {
	return (
		<Action
			className={cn(buttonVariants({ variant: "primary" }), className)}
			{...props}
		/>
	);
}

function AlertDialogCancel({
	className,
	...props
}: ComponentProps<typeof Cancel>) {
	return (
		<Cancel
			className={cn(buttonVariants({ variant: "outline" }), className)}
			{...props}
		/>
	);
}

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogTrigger,
};
