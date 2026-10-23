#!/bin/sh -e
# Audits every translation for placeholder-token mismatches, i.e. a msgstr
# whose tokens differ from its msgid's.
#
# msgfmt --check-format only understands the %s/%d style. This extension also
# uses a $-style ($d$s km/h, $dBeaufort $s, Around $t in $c) that helpers.js
# and indicator.js substitute with .replace(), which gettext knows nothing
# about - so a translation that drops or invents one of those is invisible to
# msgfmt and renders a literal "$s" in the panel. msgmerge's fuzzy matching
# produces exactly that (see CLAUDE.md, "Translation workflow").
#
# Fuzzy and obsolete entries are skipped: msgfmt leaves them out of the .mo.

cd "$(dirname "$0")/.."

findings=$(
    for po in po/*.po; do
        msgattrib --translated --no-fuzzy --no-obsolete "$po" | awk -v po="$po" '
            function content(line,   s) {
                s = line
                sub(/^[^"]*"/, "", s)
                sub(/"[^"]*$/, "", s)
                return s
            }
            function tokens(s,   out, rest, t) {
                rest = s
                while (match(rest, /%[sd]|\$[dsct]/)) {
                    t = substr(rest, RSTART, RLENGTH)
                    out = out t " "
                    rest = substr(rest, RSTART + RLENGTH)
                }
                return out
            }
            function sorted(s,   n, a, i, j, tmp, out) {
                n = split(s, a, " ")
                for (i = 1; i < n; i++)
                    for (j = i + 1; j <= n; j++)
                        if (a[i] > a[j]) { tmp = a[i]; a[i] = a[j]; a[j] = tmp }
                for (i = 1; i <= n; i++)
                    if (a[i] != "") out = out a[i] " "
                return out
            }
            function check() {
                if (id != "" && str != "" && sorted(tokens(id)) != sorted(tokens(str)))
                    printf "%s\n  msgid  \"%s\" [%s]\n  msgstr \"%s\" [%s]\n",
                        po, id, sorted(tokens(id)), str, sorted(tokens(str))
                id = ""; str = ""; field = ""
            }
            /^msgid "/      { check(); field = "id";  id  = content($0); next }
            /^msgid_plural/ { field = ""; next }
            /^msgstr/       { field = "str"; str = content($0); next }
            /^"/            { if (field == "id") id = id content($0)
                              else if (field == "str") str = str content($0)
                              next }
            /^$/            { check(); next }
            END             { check() }
        '
    done
)

if [ -n "$findings" ]; then
    echo "$findings"
    echo
    echo "Placeholder mismatch: blank and un-fuzzy the entries above, or fix the tokens."
    exit 1
fi

echo "po: placeholder tokens consistent in $(ls po/*.po | wc -l | tr -d ' ') translations"
