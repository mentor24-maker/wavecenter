/**
 * Draws a comment's rich text (core/richText.ts) as React elements. Every
 * word goes into a text node, which React escapes, so nothing in a comment is
 * ever treated as HTML; a link is drawn only for an address core has already
 * checked is http:, https: or mailto:, and opens in a new tab.
 */
import type { ReactNode } from "react";
import { parseRichText, type RichInline } from "../../core/richText.ts";

export default function RichText({ body, className }: { body: string; className?: string }) {
  return (
    <div className={className}>
      {parseRichText(body).map((block, i) =>
        block.type === "paragraph" ? (
          <p key={i}>{inline(block.children)}</p>
        ) : block.ordered ? (
          <ol key={i} start={block.start}>
            {block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
          </ol>
        ) : (
          <ul key={i}>
            {block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
          </ul>
        ),
      )}
    </div>
  );
}

function inline(nodes: RichInline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text;
      case "bold":
        return <strong key={i}>{inline(n.children)}</strong>;
      case "italic":
        return <em key={i}>{inline(n.children)}</em>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {inline(n.children)}
          </a>
        );
    }
  });
}
