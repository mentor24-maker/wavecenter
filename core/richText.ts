/**
 * The small rich-text format a Discussion comment is written in (Dane,
 * 2026-10-28: "simple rich text editors that allow links"). It is a limited
 * Markdown subset, stored as plain words:
 *
 *   **bold**   *italic* or _italic_   - a bulleted item   1. a numbered item
 *   [words](https://example.com)      a bare https://example.com
 *
 * This file turns that text into a tree of plain objects, and a client draws
 * the tree with its own elements. Nothing in a comment is ever treated as
 * HTML: anything that is not one of the marks above stays as the words typed,
 * and a link only becomes a link when it goes to http:, https: or mailto:.
 * That is what keeps a pasted `<script>` or `javascript:` link inert.
 *
 * Plain-text comments written before this existed read the same, apart from
 * lines starting "- " or "1. ", which now show as the lists they meant.
 */

export type RichInline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: RichInline[] }
  | { type: 'italic'; children: RichInline[] }
  | { type: 'link'; href: string; children: RichInline[] };

export type RichBlock =
  | { type: 'paragraph'; children: RichInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: RichInline[][] };

/** The only places a link may go. Anything else (`javascript:`, `data:`, …) stays as text. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The address a link may safely go to, or null if it may not be a link at all. */
export function safeHref(url: string): string | null {
  const raw = url.trim();
  // Spaces or control characters inside an address are a trick, not a link.
  if (raw === '' || /[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;

/** A comment's words as blocks: paragraphs and lists. */
export function parseRichText(body: string): RichBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (const line of lines) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      endParagraph();
      const ordered = Boolean(numbered);
      const text = bullet ? bullet[1] : numbered![2];
      const last = blocks[blocks.length - 1];
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(parseInline(text));
      else blocks.push({ type: 'list', ordered, start: numbered ? Number(numbered[1]) : 1, items: [parseInline(text)] });
    } else if (line.trim() === '') {
      endParagraph();
      // A blank line also ends a list, so the next item starts a new one.
      blocks.push({ type: 'paragraph', children: [] });
    } else {
      // A line under a list item that is not itself an item starts a paragraph.
      paragraph.push(line);
    }
  }
  endParagraph();
  // Blank lines only separate blocks; they are not blocks of their own.
  return blocks.filter((b) => b.type === 'list' || b.children.length > 0);
}

/** How deep marks may nest (bold inside a link inside italic …) before the rest stays as text. */
const MAX_DEPTH = 4;
const AUTOLINK = /^(?:https?:\/\/|mailto:)[^\s<>"]+/i;
const ESCAPABLE = '\\*_[]()`-#+.!';

/** One line's (or paragraph's) words, with bold, italic and links picked out. */
export function parseInline(text: string, depth = 0, allowLinks = true): RichInline[] {
  const out: RichInline[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ type: 'text', text: plain });
    plain = '';
  };
  const inner = (s: string, links = allowLinks) =>
    depth >= MAX_DEPTH ? [{ type: 'text' as const, text: s }] : parseInline(s, depth + 1, links);
  // Once a search for a closing mark fails, every later search for it fails
  // too, so remember that and keep a long comment of stray marks quick.
  const noCloser = new Set<string>();

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    if (c === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (c === '*' && text[i + 1] === '*') {
      const end = findCloser(text, i + 2, '**', noCloser);
      if (end > i + 2) {
        flush();
        out.push({ type: 'bold', children: inner(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (c === '*' || (c === '_' && !isWordChar(text[i - 1]))) {
      const end = findCloser(text, i + 1, c, noCloser);
      if (end > i + 1) {
        flush();
        out.push({ type: 'italic', children: inner(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    } else if (c === '[' && allowLinks) {
      const link = readLink(text, i);
      if (link) {
        const href = safeHref(link.url);
        if (href) {
          flush();
          // No link inside a link's words.
          out.push({ type: 'link', href, children: inner(link.label, false) });
          i = link.end;
          continue;
        }
        // An address that may not be a link stays exactly as typed, inert.
        plain += text.slice(i, link.end);
        i = link.end;
        continue;
      }
    } else if (allowLinks && (c === 'h' || c === 'H' || c === 'm' || c === 'M') && !isWordChar(text[i - 1])) {
      const rest = text.slice(i, i + 2048);
      const bare = AUTOLINK.exec(rest);
      if (bare) {
        // Trailing punctuation belongs to the sentence, not the address.
        const url = bare[0].replace(/[.,;:!?'")\]]+$/, '');
        const href = safeHref(url);
        if (href && url.length > rest.indexOf(':') + 1) {
          flush();
          out.push({ type: 'link', href, children: [{ type: 'text', text: url }] });
          i += url.length;
          continue;
        }
      }
    }

    plain += c;
    i += 1;
  }
  flush();
  return out;
}

/**
 * Where the closing `mark` for an opening one starts, or -1. The words between
 * must not start or end with a space, so "2 * 3 * 4" stays as typed; a single
 * `*` never closes on half of a `**`; and `_` closes only at a word's end, so
 * snake_case_names stay as typed.
 */
function findCloser(text: string, from: number, mark: string, noCloser: Set<string>): number {
  if (noCloser.has(mark) || /\s/.test(text[from] ?? ' ')) return -1;
  let at = text.indexOf(mark, from);
  while (at !== -1) {
    const ok =
      at > from &&
      !/\s/.test(text[at - 1]) &&
      (mark !== '*' || (text[at + 1] !== '*' && text[at - 1] !== '*')) &&
      (mark !== '_' || !isWordChar(text[at + 1]));
    if (ok) return at;
    at = text.indexOf(mark, at + mark.length);
  }
  noCloser.add(mark);
  return -1;
}

/** `[words](address)` starting at `start`, or null. */
function readLink(text: string, start: number): { label: string; url: string; end: number } | null {
  const close = text.indexOf('](', start + 1);
  if (close === -1) return null;
  const label = text.slice(start + 1, close);
  if (label.trim() === '' || label.includes('\n') || label.includes('[')) return null;
  const end = text.indexOf(')', close + 2);
  if (end === -1) return null;
  const url = text.slice(close + 2, end);
  if (url.includes('\n')) return null;
  return { label, url, end: end + 1 };
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/** The words a comment shows, without its marks: what the search box looks in. */
export function richTextPlain(body: string): string {
  const inline = (nodes: RichInline[]): string =>
    nodes.map((n) => (n.type === 'text' ? n.text : inline(n.children))).join('');
  return parseRichText(body)
    .map((b) => (b.type === 'paragraph' ? inline(b.children) : b.items.map(inline).join('\n')))
    .join('\n');
}

/** A toolbar button in the comment box. */
export type RichFormat = 'bold' | 'italic' | 'bullets' | 'numbers';

/** The comment box's words and what is selected in it. */
export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

/**
 * Apply a toolbar button to the selected words: wrap them in bold or italic
 * marks, or turn the selected lines into a list. With nothing selected, it
 * puts the marks in and leaves the cursor between them.
 */
export function applyFormat(edit: TextEdit, format: RichFormat): TextEdit {
  const { value, start, end } = edit;
  if (format === 'bold' || format === 'italic') {
    const mark = format === 'bold' ? '**' : '*';
    const chosen = value.slice(start, end);
    // Keep spaces outside the marks, or the marks would not count.
    const lead = chosen.length - chosen.trimStart().length;
    const trail = chosen.length - chosen.trimEnd().length;
    const words = chosen.trim();
    const next = value.slice(0, start + lead) + mark + words + mark + value.slice(end - trail);
    const at = start + lead + mark.length;
    return { value: next, start: at, end: at + words.length };
  }

  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', Math.max(end - (end > start ? 1 : 0), start));
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const listed = lines.map((line, n) => {
    const words = line.replace(BULLET, '$1').replace(NUMBERED, '$2');
    return format === 'bullets' ? `- ${words}` : `${n + 1}. ${words}`;
  });
  const block = listed.join('\n');
  const next = value.slice(0, lineStart) + block + value.slice(lineEnd);
  return { value: next, start: lineStart + block.length, end: lineStart + block.length };
}

/**
 * Put a link to `url` on the selected words (or on the address itself when
 * nothing is selected). Returns null when the address may not be a link.
 */
export function applyLink(edit: TextEdit, url: string): TextEdit | null {
  const href = safeHref(url);
  if (!href) return null;
  const { value, start, end } = edit;
  // Square brackets would end the link's words early, so they become round ones.
  const words = (value.slice(start, end).trim() || url.trim()).replace(/\[/g, '(').replace(/\]/g, ')').replace(/\n+/g, ' ');
  const text = `[${words}](${url.trim().replace(/\)/g, '%29')})`;
  const at = start + text.length;
  return { value: value.slice(0, start) + text + value.slice(end), start: at, end: at };
}
