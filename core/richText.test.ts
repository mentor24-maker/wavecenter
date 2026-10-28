import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFormat, applyLink, parseInline, parseRichText, richTextPlain, richTextSearchable, safeHref } from './richText.ts';

const text = (t: string) => ({ type: 'text', text: t });

test('bold, italic and links are picked out of a line', () => {
  assert.deepEqual(parseInline('a **big** and *small* and _also_ [docs](https://example.com/a)'), [
    text('a '),
    { type: 'bold', children: [text('big')] },
    text(' and '),
    { type: 'italic', children: [text('small')] },
    text(' and '),
    { type: 'italic', children: [text('also')] },
    text(' '),
    { type: 'link', href: 'https://example.com/a', children: [text('docs')] },
  ]);
});

test('marks nest: bold words inside a link', () => {
  assert.deepEqual(parseInline('[**go** here](mailto:dane@example.com)'), [
    { type: 'link', href: 'mailto:dane@example.com', children: [{ type: 'bold', children: [text('go')] }, text(' here')] },
  ]);
});

test('a bare web address becomes a link, without the full stop after it', () => {
  assert.deepEqual(parseInline('see https://example.com/x?y=1. ok'), [
    text('see '),
    { type: 'link', href: 'https://example.com/x?y=1', children: [text('https://example.com/x?y=1')] },
    text('. ok'),
  ]);
});

test('plain text with stray marks stays exactly as typed', () => {
  for (const s of ['2 * 3 * 4', 'snake_case_name here', '**not closed', 'a * b', 'cost: 5*', '[not a link]', '\\*literal\\*']) {
    const parsed = parseInline(s);
    const shown = parsed.map((n) => (n.type === 'text' ? n.text : '?')).join('');
    assert.equal(shown, s.replace(/\\\*/g, '*'), s);
  }
});

test('nothing unsafe becomes a link or markup: script, onerror and javascript: stay as text', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click]( javascript:alert(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
    '[click](java\tscript:alert(1))',
    'javascript:alert(1)',
  ];
  for (const a of attacks) {
    const blocks = parseRichText(a);
    const json = JSON.stringify(blocks);
    assert.ok(!json.includes('"type":"link"'), `${a} made a link`);
    assert.equal(richTextPlain(a), a, `${a} was not kept as typed`);
  }
});

test('safeHref allows only http, https and mailto', () => {
  assert.equal(safeHref('https://example.com'), 'https://example.com/');
  assert.equal(safeHref('http://example.com/a b'), null);
  assert.equal(safeHref('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('vbscript:x'), null);
  assert.equal(safeHref('/relative'), null);
  assert.equal(safeHref(''), null);
});

test('lines starting "- " or "1. " become lists; other lines are paragraphs', () => {
  assert.deepEqual(parseRichText('Plan:\n- one\n- **two**\n\n1. first\n2. second\nafter'), [
    { type: 'paragraph', children: [text('Plan:')] },
    { type: 'list', ordered: false, start: 1, items: [[text('one')], [{ type: 'bold', children: [text('two')] }]] },
    { type: 'list', ordered: true, start: 1, items: [[text('first')], [text('second')]] },
    { type: 'paragraph', children: [text('after')] },
  ]);
});

test('an old plain-text comment reads the same, line breaks kept', () => {
  assert.deepEqual(parseRichText('Line one\nLine two\n\n\nNew paragraph'), [
    { type: 'paragraph', children: [text('Line one\nLine two')] },
    { type: 'paragraph', children: [text('New paragraph')] },
  ]);
});

test('richTextPlain is the shown words without the marks', () => {
  assert.equal(richTextPlain('a **big** [link](https://x.com)\n- item'), 'a big link\nitem');
});

test('a long run of stray marks is parsed quickly', () => {
  const started = Date.now();
  parseRichText('*_['.repeat(3300) + '**'.repeat(1000));
  assert.ok(Date.now() - started < 1000);
});

test('applyFormat wraps the selection in bold or italic, keeping spaces outside', () => {
  assert.deepEqual(applyFormat({ value: 'make this bold', start: 4, end: 10 }, 'bold'), {
    value: 'make **this** bold', start: 7, end: 11,
  });
  assert.deepEqual(applyFormat({ value: 'ab', start: 1, end: 1 }, 'italic'), { value: 'a**b', start: 2, end: 2 });
});

test('applyFormat turns the selected lines into a list, replacing an old list mark', () => {
  assert.equal(applyFormat({ value: 'top\nalpha\nbeta', start: 5, end: 12 }, 'bullets').value, 'top\n- alpha\n- beta');
  assert.equal(applyFormat({ value: '- alpha\n- beta', start: 0, end: 14 }, 'numbers').value, '1. alpha\n2. beta');
  assert.equal(applyFormat({ value: 'one', start: 3, end: 3 }, 'bullets').value, '- one');
});

test('applyLink links the selection, or refuses an unsafe address', () => {
  const linked = applyLink({ value: 'read the [docs] now', start: 9, end: 15 }, 'https://example.com/a)b');
  assert.equal(linked?.value, 'read the [(docs)](https://example.com/a%29b) now');
  assert.equal(JSON.stringify(parseRichText(linked!.value)).includes('"href":"https://example.com/a%29b"'), true);
  assert.equal(applyLink({ value: '', start: 0, end: 0 }, 'https://x.com')?.value, '[https://x.com](https://x.com)');
  assert.equal(applyLink({ value: 'x', start: 0, end: 1 }, 'javascript:alert(1)'), null);
});

test('a backslash stays unless it stops a mark formatting', () => {
  assert.equal(richTextPlain('C:\\.config and \\\\server\\share'), 'C:\\.config and \\\\server\\share');
  assert.equal(richTextPlain('C:\\_drafts'), 'C:\\_drafts');
  assert.deepEqual(parseInline('\\*not italic*'), [text('*not italic*')]);
  assert.deepEqual(parseInline('\\**not bold**'), [text('**not bold**')]);
  assert.deepEqual(parseInline('\\[x](https://x.com) \\* lone'), [text('[x](https://x.com) \\* lone')]);
});

test('a link address may hold paired brackets', () => {
  assert.deepEqual(parseInline('[w](https://en.wikipedia.org/wiki/Foo_(bar)) next'), [
    { type: 'link', href: 'https://en.wikipedia.org/wiki/Foo_(bar)', children: [text('w')] },
    text(' next'),
  ]);
});

test('richTextSearchable adds each link address to the shown words', () => {
  assert.equal(richTextSearchable('see [the plan](https://x.com/plan) and https://y.org'), 'see the plan and https://y.org\nhttps://x.com/plan\nhttps://y.org/');
});

test('applyFormat with only spaces selected puts the marks after them', () => {
  assert.deepEqual(applyFormat({ value: 'a   b', start: 1, end: 4 }, 'bold'), { value: 'a   ****b', start: 6, end: 6 });
});

test('applyFormat on the top line of a box that starts with a line break', () => {
  assert.equal(applyFormat({ value: '\nfoo', start: 0, end: 0 }, 'bullets').value, '- \nfoo');
});

test('applyFormat replaces only one old list mark', () => {
  assert.equal(applyFormat({ value: '- 1. foo', start: 0, end: 8 }, 'numbers').value, '1. 1. foo');
});

test('an escaped pair of marks drops both backslashes', () => {
  assert.deepEqual(parseInline('\\**both\\** and \\*one\\*'), [text('**both** and *one*')]);
});

test('applyLink output reads back as one link, brackets and all', () => {
  const linked = applyLink({ value: 'see wiki now', start: 4, end: 8 }, 'https://en.wikipedia.org/wiki/Foo_(bar)');
  assert.equal(linked?.value, 'see [wiki](https://en.wikipedia.org/wiki/Foo_%28bar%29) now');
  assert.deepEqual(parseInline(linked!.value), [
    text('see '),
    { type: 'link', href: 'https://en.wikipedia.org/wiki/Foo_%28bar%29', children: [text('wiki')] },
    text(' now'),
  ]);
  const odd = applyLink({ value: '', start: 0, end: 0 }, 'https://x.com/a(b');
  assert.equal(parseInline(odd!.value).length, 1);
});

test('a bare address keeps a closing bracket that pairs with one inside it', () => {
  assert.deepEqual(parseInline('see https://en.wikipedia.org/wiki/Foo_(bar) now'), [
    text('see '),
    { type: 'link', href: 'https://en.wikipedia.org/wiki/Foo_(bar)', children: [text('https://en.wikipedia.org/wiki/Foo_(bar)')] },
    text(' now'),
  ]);
  assert.deepEqual(parseInline('(see https://x.com/a).'), [
    text('(see '),
    { type: 'link', href: 'https://x.com/a', children: [text('https://x.com/a')] },
    text(').'),
  ]);
});

test('Bold or Italic on words that already have the mark takes it off', () => {
  const once = applyFormat({ value: 'a', start: 0, end: 1 }, 'bold');
  assert.deepEqual(once, { value: '**a**', start: 2, end: 3 });
  assert.deepEqual(applyFormat(once, 'bold'), { value: 'a', start: 0, end: 1 });
  // The marks chosen along with the words.
  assert.deepEqual(applyFormat({ value: 'x **a** y', start: 2, end: 7 }, 'bold'), { value: 'x a y', start: 2, end: 3 });
  // Nothing selected: Bold, then Bold again, leaves the box as it was.
  const empty = applyFormat({ value: 'ab', start: 1, end: 1 }, 'bold');
  assert.deepEqual(applyFormat(empty, 'bold'), { value: 'ab', start: 1, end: 1 });
  // Italic toggles on its own, even inside bold.
  const italic = applyFormat({ value: 'a', start: 0, end: 1 }, 'italic');
  assert.deepEqual(applyFormat(italic, 'italic'), { value: 'a', start: 0, end: 1 });
  assert.equal(applyFormat({ value: '**a**', start: 2, end: 3 }, 'italic').value, '***a***');
  assert.equal(applyFormat({ value: '***a***', start: 3, end: 4 }, 'italic').value, '**a**');
  assert.equal(applyFormat({ value: '***a***', start: 3, end: 4 }, 'bold').value, '*a*');
  assert.equal(applyFormat({ value: '_a_', start: 1, end: 2 }, 'italic').value, 'a');
  // Two bold words chosen together are not one bold run: wrap, don't strip.
  assert.equal(applyFormat({ value: '**a** b **c**', start: 0, end: 13 }, 'bold').value.startsWith('****'), true);
});

test('a list button leaves blank lines between the chosen lines blank', () => {
  assert.equal(applyFormat({ value: 'a\n\nb', start: 0, end: 4 }, 'bullets').value, '- a\n\n- b');
  assert.equal(applyFormat({ value: 'a\n\nb', start: 0, end: 4 }, 'numbers').value, '1. a\n\n2. b');
});

test('Bold then Italic on one word reads back as one bold and italic run', () => {
  const bold = applyFormat({ value: 'a', start: 0, end: 1 }, 'bold');
  const both = applyFormat(bold, 'italic');
  assert.equal(both.value, '***a***');
  const expected = [{ type: 'bold', children: [{ type: 'italic', children: [text('a')] }] }];
  assert.deepEqual(parseInline(both.value), expected);
  assert.deepEqual(parseInline(applyFormat(applyFormat({ value: 'a', start: 0, end: 1 }, 'italic'), 'bold').value), expected);
  assert.deepEqual(parseInline('x ***big*** y'), [text('x '), { type: 'bold', children: [{ type: 'italic', children: [text('big')] }] }, text(' y')]);
});

test('Bold or Italic never takes off characters that were not formatting the words', () => {
  // Underscores inside snake_case_names are plain, so Italic adds a mark.
  assert.equal(applyFormat({ value: 'snake_case_names', start: 6, end: 10 }, 'italic').value, 'snake_*case*_names');
  // The stars either side of "c" are halves of two different marks: the bold on "b" stays.
  const bolded = applyFormat({ value: 'a**b**c**d', start: 6, end: 7 }, 'bold').value;
  assert.equal(bolded, 'a**b****c****d');
  assert.deepEqual(parseInline(bolded).slice(0, 2), [text('a'), { type: 'bold', children: [text('b')] }]);
  // A real pair just outside the words still comes off.
  assert.equal(applyFormat({ value: 'x _a_ y', start: 3, end: 4 }, 'italic').value, 'x a y');
  assert.equal(applyFormat({ value: '**_a_**', start: 3, end: 4 }, 'italic').value, '**a**');
});

test('an escaped opening mark keeps its partner plain, backslash or not', () => {
  assert.deepEqual(parseInline('\\*foo*bar*'), [text('*foo*bar*')]);
  assert.deepEqual(parseInline('\\**foo**bar**'), [text('**foo**bar**')]);
});

test('applyLink keeps chosen spaces outside the link', () => {
  assert.equal(applyLink({ value: 'go here now', start: 3, end: 8 }, 'https://x.com')?.value, 'go [here](https://x.com) now');
  assert.equal(applyLink({ value: 'go  now', start: 2, end: 4 }, 'https://x.com')?.value, 'go  [https://x.com](https://x.com)now');
});

test('search finds a toolbar link by the address as typed, brackets and all', () => {
  const linked = applyLink({ value: 'wiki', start: 0, end: 4 }, 'https://en.wikipedia.org/wiki/Foo_(bar)')!.value;
  assert.ok(richTextSearchable(linked).includes('https://en.wikipedia.org/wiki/Foo_(bar)'));
});
