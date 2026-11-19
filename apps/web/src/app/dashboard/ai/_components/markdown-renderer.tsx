import { Fragment, type ReactNode } from "react";

const ORDERED_LIST_PATTERN = /^\d+\.\s+(?<item>.*)$/u;
const HEADING_PATTERN = /^(?<hashes>#{1,6})\s+(?<text>.+)$/u;
const HORIZONTAL_RULE_PATTERN = /^(?:---+|\*\*\*+|___+)$/u;
const BLOCKQUOTE_PATTERN = /^>\s?(?<text>.*)$/u;
const TABLE_SEPARATOR_CELL_PATTERN = /^:?-{3,}:?$/u;
const LEADING_PIPE_PATTERN = /^\|/u;
const TRAILING_PIPE_PATTERN = /\|$/u;
const INLINE_TOKEN_PATTERN =
	/(?<token>`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/gu;

function sanitizeHref(rawHref: string): string | null {
	try {
		const url = new URL(rawHref);
		if (url.protocol === "http:" || url.protocol === "https:") {
			return url.toString();
		}
		return null;
	} catch {
		return null;
	}
}

function renderLinkToken(token: string, tokenKey: string): ReactNode {
	const separatorIndex = token.indexOf("](");
	if (separatorIndex <= 1 || !token.endsWith(")")) {
		return token;
	}
	const label = token.slice(1, separatorIndex);
	const href = sanitizeHref(token.slice(separatorIndex + 2, -1));
	if (!href) {
		return label;
	}
	return (
		<a
			className="text-primary underline underline-offset-2 hover:opacity-80"
			href={href}
			key={tokenKey}
			rel="noopener noreferrer"
			target="_blank"
		>
			{label}
		</a>
	);
}

function renderMarkdownToken(token: string, tokenKey: string): ReactNode {
	if (token.startsWith("`") && token.endsWith("`")) {
		return (
			<code
				className="bg-background/80 rounded px-1 py-0.5 font-mono text-[12px]"
				key={tokenKey}
			>
				{token.slice(1, -1)}
			</code>
		);
	}
	if (token.startsWith("**") && token.endsWith("**")) {
		return (
			<strong className="font-semibold" key={tokenKey}>
				{token.slice(2, -2)}
			</strong>
		);
	}
	if (token.startsWith("~~") && token.endsWith("~~")) {
		return <del key={tokenKey}>{token.slice(2, -2)}</del>;
	}
	if (token.startsWith("*") && token.endsWith("*")) {
		return <em key={tokenKey}>{token.slice(1, -1)}</em>;
	}
	if (token.startsWith("[")) {
		return renderLinkToken(token, tokenKey);
	}
	return token;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let lastIndex = 0;
	let tokenIndex = 0;

	for (const match of text.matchAll(INLINE_TOKEN_PATTERN)) {
		const [token = ""] = match;
		const matchIndex = match.index ?? 0;
		if (matchIndex > lastIndex) {
			nodes.push(text.slice(lastIndex, matchIndex));
		}
		nodes.push(renderMarkdownToken(token, `${keyPrefix}-${tokenIndex}`));
		tokenIndex += 1;
		lastIndex = matchIndex + token.length;
	}

	if (lastIndex < text.length) {
		nodes.push(text.slice(lastIndex));
	}

	return nodes;
}

function parseTableCells(line: string): string[] {
	const trimmed = line.trim();
	const stripped = trimmed
		.replace(LEADING_PIPE_PATTERN, "")
		.replace(TRAILING_PIPE_PATTERN, "");
	return stripped.split("|").map((cell) => cell.trim());
}

function isTableStart(lines: string[], index: number): boolean {
	const headerLine = (lines[index] ?? "").trim();
	const separatorLine = (lines[index + 1] ?? "").trim();
	if (!(headerLine.includes("|") && separatorLine.includes("|"))) {
		return false;
	}
	const separatorCells = parseTableCells(separatorLine);
	return (
		separatorCells.length > 0 &&
		separatorCells.every((cell) => TABLE_SEPARATOR_CELL_PATTERN.test(cell))
	);
}

function parseTableBlock(
	lines: string[],
	startIndex: number,
	keyPrefix: string
): { nextIndex: number; node: ReactNode } {
	const rawHeaders = parseTableCells(lines[startIndex] ?? "");
	const tableKey = `${keyPrefix}-table-${startIndex}`;
	const columns: Array<{ colIndex: number; colKey: string; label: string }> =
		[];
	let colIndex = 0;
	for (const label of rawHeaders) {
		columns.push({
			colIndex,
			colKey: `${tableKey}-col-${colIndex}`,
			label,
		});
		colIndex += 1;
	}

	const rows: Array<{ cells: string[]; lineNumber: number }> = [];
	let index = startIndex + 2;

	while (index < lines.length) {
		const rowLine = (lines[index] ?? "").trim();
		if (rowLine.length === 0 || !rowLine.includes("|")) {
			break;
		}
		rows.push({ cells: parseTableCells(rowLine), lineNumber: index });
		index += 1;
	}

	return {
		nextIndex: index,
		node: (
			<div
				className="border-border/60 overflow-x-auto rounded-lg border"
				key={tableKey}
			>
				<table className="w-full border-collapse text-left text-xs">
					<thead className="bg-background/70 border-border/60 border-b">
						<tr>
							{columns.map((col) => (
								<th className="px-2.5 py-1.5 font-semibold" key={col.colKey}>
									{renderInlineMarkdown(col.label, col.colKey)}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="divide-border/40 divide-y">
						{rows.map((row) => (
							<tr key={`${tableKey}-tr-${row.lineNumber}`}>
								{columns.map((col) => {
									const cellKey = `${tableKey}-td-${row.lineNumber}-${col.colKey}`;
									return (
										<td className="px-2.5 py-1.5 align-top" key={cellKey}>
											{renderInlineMarkdown(
												row.cells[col.colIndex] ?? "",
												cellKey
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		),
	};
}

function parseCodeBlock(
	lines: string[],
	startIndex: number,
	keyPrefix: string
): { nextIndex: number; node: ReactNode } {
	const codeLines: string[] = [];
	let index = startIndex + 1;
	while (index < lines.length) {
		const codeLine = lines[index] ?? "";
		index += 1;
		if (codeLine.trim().startsWith("```")) {
			break;
		}
		codeLines.push(codeLine);
	}
	return {
		nextIndex: index,
		node: (
			<pre
				className="bg-background/80 border-border/60 overflow-x-auto rounded-lg border p-3 font-mono text-xs leading-relaxed"
				key={`${keyPrefix}-code-${startIndex}`}
			>
				<code>{codeLines.join("\n")}</code>
			</pre>
		),
	};
}

function parseBlockquoteBlock(
	lines: string[],
	startIndex: number,
	keyPrefix: string
): { nextIndex: number; node: ReactNode } {
	const quoteLines: Array<{ lineNumber: number; text: string }> = [];
	let index = startIndex;
	while (index < lines.length) {
		const match = BLOCKQUOTE_PATTERN.exec((lines[index] ?? "").trim());
		const quoteText = match?.groups?.text;
		if (quoteText === undefined) {
			break;
		}
		quoteLines.push({ lineNumber: index, text: quoteText });
		index += 1;
	}
	const quoteKey = `${keyPrefix}-quote-${startIndex}`;
	return {
		nextIndex: index,
		node: (
			<blockquote
				className="border-primary/40 text-muted-foreground space-y-1 border-l-2 pl-3 italic"
				key={quoteKey}
			>
				{quoteLines.map((line) => (
					<p key={`${quoteKey}-line-${line.lineNumber}`}>
						{renderInlineMarkdown(
							line.text,
							`${quoteKey}-line-${line.lineNumber}`
						)}
					</p>
				))}
			</blockquote>
		),
	};
}

function parseUnorderedListBlock(
	lines: string[],
	startIndex: number,
	keyPrefix: string
): { nextIndex: number; node: ReactNode } {
	const items: Array<{ lineNumber: number; text: string }> = [];
	let index = startIndex;
	while (index < lines.length) {
		const itemLine = (lines[index] ?? "").trim();
		if (!(itemLine.startsWith("- ") || itemLine.startsWith("* "))) {
			break;
		}
		items.push({ lineNumber: index, text: itemLine.slice(2) });
		index += 1;
	}
	const listKey = `${keyPrefix}-ul-${startIndex}`;
	return {
		nextIndex: index,
		node: (
			<ul className="list-disc space-y-1 pl-5" key={listKey}>
				{items.map((item) => (
					<li key={`${listKey}-line-${item.lineNumber}`}>
						{renderInlineMarkdown(
							item.text,
							`${listKey}-line-${item.lineNumber}`
						)}
					</li>
				))}
			</ul>
		),
	};
}

function parseOrderedListBlock(
	lines: string[],
	startIndex: number,
	keyPrefix: string
): { nextIndex: number; node: ReactNode } {
	const items: Array<{ lineNumber: number; text: string }> = [];
	let index = startIndex;
	while (index < lines.length) {
		const itemLine = (lines[index] ?? "").trim();
		const match = ORDERED_LIST_PATTERN.exec(itemLine);
		const itemText = match?.groups?.item;
		if (itemText === undefined) {
			break;
		}
		items.push({ lineNumber: index, text: itemText });
		index += 1;
	}
	const listKey = `${keyPrefix}-ol-${startIndex}`;
	return {
		nextIndex: index,
		node: (
			<ol className="list-decimal space-y-1 pl-5" key={listKey}>
				{items.map((item) => (
					<li key={`${listKey}-line-${item.lineNumber}`}>
						{renderInlineMarkdown(
							item.text,
							`${listKey}-line-${item.lineNumber}`
						)}
					</li>
				))}
			</ol>
		),
	};
}

function isBlockStarter(lines: string[], index: number): boolean {
	const trimmedLine = (lines[index] ?? "").trim();
	return (
		trimmedLine.length === 0 ||
		trimmedLine.startsWith("```") ||
		HEADING_PATTERN.test(trimmedLine) ||
		HORIZONTAL_RULE_PATTERN.test(trimmedLine) ||
		BLOCKQUOTE_PATTERN.test(trimmedLine) ||
		trimmedLine.startsWith("- ") ||
		trimmedLine.startsWith("* ") ||
		ORDERED_LIST_PATTERN.test(trimmedLine) ||
		isTableStart(lines, index)
	);
}

function parseParagraphBlock(
	lines: string[],
	startIndex: number,
	keyPrefix: string
): { nextIndex: number; node: ReactNode } {
	const paragraphLines: Array<{ lineNumber: number; text: string }> = [
		{ lineNumber: startIndex, text: lines[startIndex] ?? "" },
	];
	let index = startIndex + 1;
	while (index < lines.length) {
		if (isBlockStarter(lines, index)) {
			break;
		}
		paragraphLines.push({ lineNumber: index, text: lines[index] ?? "" });
		index += 1;
	}
	const paragraphKey = `${keyPrefix}-p-${startIndex}`;
	return {
		nextIndex: index,
		node: (
			<p className="wrap-break-word" key={paragraphKey}>
				{paragraphLines.map((line, offset) => (
					<Fragment key={`${paragraphKey}-line-${line.lineNumber}`}>
						{offset > 0 ? <br /> : null}
						{renderInlineMarkdown(
							line.text,
							`${paragraphKey}-line-${line.lineNumber}`
						)}
					</Fragment>
				))}
			</p>
		),
	};
}

function parseHeadingBlock(
	trimmed: string,
	lineNumber: number,
	keyPrefix: string
): ReactNode | null {
	const match = HEADING_PATTERN.exec(trimmed);
	const hashes = match?.groups?.hashes;
	const headingText = match?.groups?.text;
	if (!(hashes && headingText)) {
		return null;
	}

	const level = hashes.length;
	const headingKey = `${keyPrefix}-h${level}-${lineNumber}`;
	const content = renderInlineMarkdown(headingText, headingKey);

	if (level <= 2) {
		return (
			<h2 className="text-sm font-semibold" key={headingKey}>
				{content}
			</h2>
		);
	}
	if (level === 3) {
		return (
			<h3 className="text-sm font-semibold" key={headingKey}>
				{content}
			</h3>
		);
	}
	return (
		<h4
			className="text-xs font-semibold tracking-wide uppercase"
			key={headingKey}
		>
			{content}
		</h4>
	);
}

export function renderSafeMarkdown(text: string, keyPrefix: string): ReactNode {
	const lines = text.replaceAll("\r\n", "\n").split("\n");
	const blocks: ReactNode[] = [];
	let index = 0;

	while (index < lines.length) {
		const trimmed = (lines[index] ?? "").trim();
		if (trimmed.length === 0) {
			index += 1;
			continue;
		}
		if (trimmed.startsWith("```")) {
			const parsed = parseCodeBlock(lines, index, keyPrefix);
			blocks.push(parsed.node);
			index = Math.max(parsed.nextIndex, index + 1);
			continue;
		}
		const heading = parseHeadingBlock(trimmed, index, keyPrefix);
		if (heading) {
			blocks.push(heading);
			index += 1;
			continue;
		}
		if (HORIZONTAL_RULE_PATTERN.test(trimmed)) {
			blocks.push(
				<hr
					className="border-border/60 my-2"
					key={`${keyPrefix}-hr-${index}`}
				/>
			);
			index += 1;
			continue;
		}
		if (BLOCKQUOTE_PATTERN.test(trimmed)) {
			const parsed = parseBlockquoteBlock(lines, index, keyPrefix);
			blocks.push(parsed.node);
			index = Math.max(parsed.nextIndex, index + 1);
			continue;
		}
		if (isTableStart(lines, index)) {
			const parsed = parseTableBlock(lines, index, keyPrefix);
			blocks.push(parsed.node);
			index = Math.max(parsed.nextIndex, index + 1);
			continue;
		}
		if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
			const parsed = parseUnorderedListBlock(lines, index, keyPrefix);
			blocks.push(parsed.node);
			index = Math.max(parsed.nextIndex, index + 1);
			continue;
		}
		if (ORDERED_LIST_PATTERN.test(trimmed)) {
			const parsed = parseOrderedListBlock(lines, index, keyPrefix);
			blocks.push(parsed.node);
			index = Math.max(parsed.nextIndex, index + 1);
			continue;
		}
		const parsed = parseParagraphBlock(lines, index, keyPrefix);
		blocks.push(parsed.node);
		index = Math.max(parsed.nextIndex, index + 1);
	}

	if (blocks.length === 0) {
		return (
			<p className="wrap-break-word whitespace-pre-wrap" key={keyPrefix}>
				{text}
			</p>
		);
	}

	return <div className="space-y-2">{blocks}</div>;
}
