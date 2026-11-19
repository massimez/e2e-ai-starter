"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
	const { theme, setTheme } = useTheme();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="Toggle color theme"
					className="relative h-9 w-9 rounded-lg"
					size="icon"
					type="button"
					variant="ghost"
				>
					<Sun className="h-4 w-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
					<Moon className="absolute h-4 w-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-36 rounded-xl p-1">
				<DropdownMenuItem
					className={theme === "light" ? "bg-muted font-medium" : ""}
					onClick={() => setTheme("light")}
				>
					<Sun className="mr-2 h-4 w-4" />
					Light
				</DropdownMenuItem>
				<DropdownMenuItem
					className={theme === "dark" ? "bg-muted font-medium" : ""}
					onClick={() => setTheme("dark")}
				>
					<Moon className="mr-2 h-4 w-4" />
					Dark
				</DropdownMenuItem>
				<DropdownMenuItem
					className={theme === "system" ? "bg-muted font-medium" : ""}
					onClick={() => setTheme("system")}
				>
					<Laptop className="mr-2 h-4 w-4" />
					System
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
