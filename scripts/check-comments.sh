#!/bin/sh -e
# Audits every comment in the shipped source for non-ASCII characters.
#
# An EGO reviewer raised non-ASCII comments as a finding, so this is a review
# blocker rather than a style preference (see CLAUDE.md, "Coding standards").
#
# A whole-file grep is not a usable check here: this extension's user-facing
# strings legitimately contain the degree sign, wind-direction arrow glyphs and
# an ellipsis, and a contributor's name carries an acute accent. Those are all
# correct and must not be "fixed", so the scan below parses each file enough to
# tell a comment from a string literal and only reports the former.

cd "$(dirname "$0")/.."

python3 -I - "$@" <<'EOF'
import glob
import sys
import unicodedata


def js_spans(src):
    """Yields (index, is_comment) for JS, tracking strings and both comment forms."""
    i, n, state = 0, len(src), None
    while i < n:
        c = src[i]
        if state is None:
            if c == '/' and i + 1 < n and src[i + 1] == '/':
                state = 'line'
                yield i, True
                i += 1
                yield i, True
                i += 1
                continue
            if c == '/' and i + 1 < n and src[i + 1] == '*':
                state = 'block'
                yield i, True
                i += 1
                yield i, True
                i += 1
                continue
            if c in '"\'`':
                state = c
                yield i, False
                i += 1
                continue
            yield i, False
            i += 1
            continue
        if state == 'line':
            if c == '\n':
                state = None
                yield i, False
                i += 1
                continue
            yield i, True
            i += 1
            continue
        if state == 'block':
            yield i, True
            if c == '*' and i + 1 < n and src[i + 1] == '/':
                i += 1
                yield i, True
                state = None
            i += 1
            continue
        yield i, False
        if c == '\\':
            i += 1
            if i < n:
                yield i, False
            i += 1
            continue
        if c == state:
            state = None
        i += 1


def css_spans(src):
    i, n, inc = 0, len(src), False
    while i < n:
        if not inc and src[i] == '/' and i + 1 < n and src[i + 1] == '*':
            inc = True
        yield i, inc
        if inc and i > 0 and src[i] == '/' and src[i - 1] == '*':
            inc = False
        i += 1


def sh_spans(src):
    i, n, state = 0, len(src), None
    while i < n:
        c = src[i]
        if state is None:
            if c == '#':
                state = 'c'
                yield i, True
                i += 1
                continue
            if c in '"\'':
                state = c
                yield i, False
                i += 1
                continue
            yield i, False
            i += 1
            continue
        if state == 'c':
            if c == '\n':
                state = None
                yield i, False
                i += 1
                continue
            yield i, True
            i += 1
            continue
        yield i, False
        if c == state:
            state = None
        i += 1


PARSERS = {'js': js_spans, 'css': css_spans, 'sh': sh_spans}

paths = sys.argv[1:] or sorted(
    glob.glob('*.js') + glob.glob('*.css') +
    glob.glob('tests/*.js') + glob.glob('scripts/*.sh'))

findings = []
for path in paths:
    parser = PARSERS.get(path.rsplit('.', 1)[-1])
    if not parser:
        continue
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    line = 1
    line_of = {}
    for idx, ch in enumerate(src):
        line_of[idx] = line
        if ch == '\n':
            line += 1
    seen = set()
    for idx, is_comment in parser(src):
        ch = src[idx]
        if not is_comment or ord(ch) < 128:
            continue
        key = (path, line_of[idx], ch)
        if key in seen:
            continue
        seen.add(key)
        findings.append(key)

if findings:
    for path, line, ch in findings:
        name = unicodedata.name(ch, 'unnamed')
        print(f'{path}:{line}: U+{ord(ch):04X} {name} ({ch!r}) in a comment')
    print()
    print('Comments must be ASCII-only. Use - for dashes, ... for an ellipsis,')
    print('straight quotes, -> for arrows, and -/= for dividers. Reword rather')
    print('than keeping an accented letter as an example.')
    sys.exit(1)

print(f'comments: ASCII-only in {len(paths)} files')
EOF
