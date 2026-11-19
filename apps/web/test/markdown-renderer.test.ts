import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeMarkdown } from "../src/app/dashboard/ai/_components/markdown-renderer";

describe("renderSafeMarkdown", () => {
	test("handles h4-h6 headings, hashtags, and mid-stream # tokens without hanging", () => {
		const samples = [
			"#### Level 4 Heading",
			"##### Level 5 Heading",
			"###### Level 6 Heading",
			"#",
			"##",
			"###",
			"#hashtag without space",
			"###nospace",
			"Before\n#### Heading\nAfter",
		];

		for (const sample of samples) {
			const html = renderToStaticMarkup(renderSafeMarkdown(sample, "test"));
			expect(html.length).toBeGreaterThan(0);
		}

		const h4Html = renderToStaticMarkup(
			renderSafeMarkdown("#### Quota Details", "h4")
		);
		expect(h4Html).toContain("<h4");
		expect(h4Html).toContain("Quota Details");

		const tagHtml = renderToStaticMarkup(
			renderSafeMarkdown("#release-notes", "tag")
		);
		expect(tagHtml).toContain("<p");
		expect(tagHtml).toContain("#release-notes");
	});

	test("renders GFM tables, blockquotes, horizontal rules, and unclosed streaming fences", () => {
		const md = [
			"## Summary",
			"",
			"> Quoted workspace note",
			"",
			"| Member | Role |",
			"| --- | --- |",
			"| Alice | owner |",
			"",
			"---",
			"",
			"```ts",
			"const x = 1;",
		].join("\n");

		const html = renderToStaticMarkup(renderSafeMarkdown(md, "gfm"));
		expect(html).toContain("<h2");
		expect(html).toContain("<blockquote");
		expect(html).toContain("<table");
		expect(html).toContain("<th");
		expect(html).toContain("Member</th>");
		expect(html).toContain("Alice");
		expect(html).toContain("<hr");
		expect(html).toContain("const x = 1;");
	});

	test("blocks javascript: and data: links while allowing https: links", () => {
		const md =
			"[bad](javascript:alert(1)) [data](data:text/html,hi) [good](https://example.com/docs)";
		const html = renderToStaticMarkup(renderSafeMarkdown(md, "links"));

		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("data:text/html");
		expect(html).toContain('href="https://example.com/docs"');
	});
});
