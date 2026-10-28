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
 * A backslash in front of a mark (`\*not italic*`) keeps the mark as typed.
 * Only a backslash that stops something formatting is dropped, so every other
 * backslash (`C:\.config`, `\\server`) shows as written.
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

  /** The mark starting at `at` when it formats: what it makes, how long its opening is, and where it ends. */
  const readMark = (at: number): { node: RichInline; open: number; end: number } | null => {
    const c = text[at];
    if (c === '*' && text[at + 1] === '*') {
      const end = findCloser(text, at + 2, '**', noCloser);
      return end > at + 2 ? { node: { type: 'bold', children: inner(text.slice(at + 2, end)) }, open: 2, end: end + 2 } : null;
    }
    if (c === '*' || (c === '_' && !isWordChar(text[at - 1]))) {
      const end = findCloser(text, at + 1, c, noCloser);
      return end > at + 1 ? { node: { type: 'italic', children: inner(text.slice(at + 1, end)) }, open: 1, end: end + 1 } : null;
    }
    if (c === '[' && allowLinks) {
      const link = readLink(text, at);
      const href = link && safeHref(link.url);
      // No link inside a link's words.
      return link && href ? { node: { type: 'link', href, children: inner(link.label, false) }, open: 1, end: link.end } : null;
    }
    return null;
  };

  // Where a closing mark sits whose opening one was escaped: its backslash goes too.
  const escapedClosers = new Map<number, number>();

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    if (c === '\\' && (text[i + 1] === '*' || text[i + 1] === '_' || text[i + 1] === '[')) {
      // The backslash goes only when the mark after it would have formatted,
      // or when it sits on the closing mark an escaped opening one paired with.
      // An escaped link stays whole, so its address does not become a bare link.
      const closer = escapedClosers.get(i + 1);
      const escaped = closer ? null : readMark(i + 1);
      if (escaped && escaped.node.type !== 'link') escapedClosers.set(escaped.end - escaped.open, escaped.open);
      if (closer || escaped) {
        const upto = escaped?.node.type === 'link' ? escaped.end : i + 1 + (closer ?? escaped!.open);
        plain += text.slice(i + 1, upto);
        i = upto;
        continue;
      }
    }

    const mark = readMark(i);
    if (mark) {
      flush();
      out.push(mark.node);
      i = mark.end;
      continue;
    }

    if (c === '[' && allowLinks) {
      // An address that may not be a link stays exactly as typed, inert.
      const link = readLink(text, i);
      if (link) {
        plain += text.slice(i, link.end);
        i = link.end;
        continue;
      }
    } else if (allowLinks && (c === 'h' || c === 'H' || c === 'm' || c === 'M') && !isWordChar(text[i - 1])) {
      const rest = text.slice(i, i + 2048);
      const bare = AUTOLINK.exec(rest);
      if (bare) {
        const url = trimBareAddress(bare[0]);
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

/** `[words](address)` starting at `start`, or null. Brackets inside the address must pair up, as in `…/Foo_(bar)`. */
function readLink(text: string, start: number): { label: string; url: string; end: number } | null {
  const close = text.indexOf('](', start + 1);
  if (close === -1) return null;
  const label = text.slice(start + 1, close);
  if (label.trim() === '' || label.includes('\n') || label.includes('[')) return null;
  let open = 0;
  for (let at = close + 2; at < text.length; at++) {
    const ch = text[at];
    if (ch === '\n') return null;
    if (ch === '(') open += 1;
    else if (ch === ')') {
      if (open === 0) return { label, url: text.slice(close + 2, at), end: at + 1 };
      open -= 1;
    }
  }
  return null;
}

/**
 * A bare address without the sentence's punctuation after it. A closing ")"
 * stays when it pairs with a "(" in the address, as in `…/Foo_(bar)`.
 */
function trimBareAddress(raw: string): string {
  let url = raw;
  while (/[.,;:!?'")\]]$/.test(url)) {
    if (url.endsWith(')') && count(url, '(') >= count(url, ')')) break;
    url = url.slice(0, -1);
  }
  return url;
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
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

/** What the search box looks in: the shown words, then the address of every link, so a comment is found by what it links to. */
export function richTextSearchable(body: string): string {
  const hrefs: string[] = [];
  const collect = (nodes: RichInline[]): void =>
    nodes.forEach((n) => {
      if (n.type === 'link') hrefs.push(n.href);
      if (n.type !== 'text') collect(n.children);
    });
  for (const b of parseRichText(body)) (b.type === 'paragraph' ? [b.children] : b.items).forEach(collect);
  return [richTextPlain(body), ...hrefs].join('\n');
}

/** A toolbar button in the comment box. */
export type RichFormat = 'bold' | 'italic' | 'bullets' | 'numbers';

/** The comment box's words and what is selected in it. */
export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

/** How many `*` sit side by side starting at `at`, going forwards (step 1) or backwards (step -1). */
function starRun(text: string, at: number, step: 1 | -1): number {
  let n = 0;
  while (text[at + n * step] === '*') n += 1;
  return n;
}

/**
 * Apply a toolbar button to the selected words: wrap them in bold or italic
 * marks, or turn the selected lines into a list. With nothing selected, it
 * puts the marks in and leaves the cursor between them. Pressing Bold or
 * Italic on words that already have that mark takes it off again.
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
    // Where the chosen words begin and end (with only spaces chosen, the spot after them).
    const from = words === '' ? end : start + lead;
    const to = words === '' ? end : end - trail;
    // `***` is bold and italic together, so two or three stars mean bold, one or three italic.
    const marked = (stars: number) => (format === 'bold' ? stars >= 2 : stars === 1 || stars === 3);

    // The mark sits just outside the chosen words: take it off.
    const outside = Math.min(starRun(value, from - 1, -1), starRun(value, to, 1));
    const underscores = format === 'italic' && value[from - 1] === '_' && value[to] === '_';
    if ((marked(outside) && !(format === 'bold' && words.includes('**'))) || underscores) {
      const n = mark.length;
      const next = value.slice(0, from - n) + value.slice(from, to) + value.slice(to + n);
      return { value: next, start: from - n, end: to - n };
    }
    // The chosen words carry the mark themselves: take it off.
    const nodes = parseInline(words);
    if (nodes.length === 1 && nodes[0].type === format) {
      const n = format === 'bold' ? 2 : 1;
      const next = value.slice(0, from) + words.slice(n, -n) + value.slice(to);
      return { value: next, start: from, end: to - 2 * n };
    }

    // Only spaces chosen: put the marks after them, as if nothing were selected.
    if (words === '') {
      const at = end + mark.length;
      return { value: value.slice(0, end) + mark + mark + value.slice(end), start: at, end: at };
    }
    const next = value.slice(0, start + lead) + mark + words + mark + value.slice(end - trail);
    const at = start + lead + mark.length;
    return { value: next, start: at, end: at + words.length };
  }

  // lastIndexOf with -1 still looks at the first character, so the top line is its own case.
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', Math.max(end - (end > start ? 1 : 0), start));
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  let number = 0;
  const listed = lines.map((line) => {
    // A blank line between the chosen lines stays blank, not an empty item;
    // on its own, it starts the first item.
    if (lines.length > 1 && line.trim() === '') return line;
    // Replace one old list mark only, so "- 1. foo" keeps its "1.".
    const words = BULLET.exec(line)?.[1] ?? NUMBERED.exec(line)?.[2] ?? line;
    number += 1;
    return format === 'bullets' ? `- ${words}` : `${number}. ${words}`;
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
  // Both round brackets are written in their encoded form, so the address
  // always reads back whole, paired or not. A browser treats them the same.
  const text = `[${words}](${url.trim().replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  const at = start + text.length;
  return { value: value.slice(0, start) + text + value.slice(end), start: at, end: at };
}
