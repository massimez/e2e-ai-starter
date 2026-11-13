"use client";

import {
	Content as TabsContentPrimitive,
	List as TabsListPrimitive,
	Root as TabsRootPrimitive,
	Trigger as TabsTriggerPrimitive,
} from "@radix-ui/react-tabs";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

function Tabs({
	className,
	...props
}: ComponentProps<typeof TabsRootPrimitive>) {
	return (
		<TabsRootPrimitive
			className={cn("flex flex-col gap-3", className)}
			data-slot="tabs"
			{...props}
		/>
	);
}

function TabsList({
	className,
	...props
}: ComponentProps<typeof TabsListPrimitive>) {
	return (
		<TabsListPrimitive
			className={cn(
				"bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-1",
				className
			)}
			data-slot="tabs-list"
			{...props}
		/>
	);
}

function TabsTrigger({
	className,
	...props
}: ComponentProps<typeof TabsTriggerPrimitive>) {
	return (
		<TabsTriggerPrimitive
			className={cn(
				"ring-offset-background focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-xs",
				className
			)}
			data-slot="tabs-trigger"
			{...props}
		/>
	);
}

function TabsContent({
	className,
	...props
}: ComponentProps<typeof TabsContentPrimitive>) {
	return (
		<TabsContentPrimitive
			className={cn(
				"ring-offset-background focus-visible:ring-ring flex-1 outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
				className
			)}
			data-slot="tabs-content"
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
