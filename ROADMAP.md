# Roadmap

Plan for the remaining feature ideas from the 2026-09-22 brainstorm. Each
section is meant to be picked up by a fresh session on its own: read
`CLAUDE.md` first (lifecycle rules, testing setup, schema rules now that the
extension is public), then the section you're working on.

Dev-only file: `scripts/pack.sh` lists shipped files explicitly, so this never
ends up in the EGO zip.

## Status

| # | Feature | Status |
|---|---------|--------|
| 1 | Rain/snow/thunderstorm alert | Released 2026-10-27 |
| 2 | Scroll on panel button to switch location | Released 2026-10-27 |
| 3 | Temperature trend arrow in the panel | Released 2026-10-27 |
| 4 | Moon phase in the dropdown | Released 2026-10-27 |
| 5 | "Open in GNOME Weather" menu item | Dropped 2026-09-22, not wanted |
| 6 | Full translation of all shipped languages | Released 2026-10-27, 32 languages |
| - | Release 1.1 to extensions.gnome.org | Approved by EGO 2026-10-27 |
| 7 | Hourly temperature chart | Dropped 2026-10-28, not wanted |
| 8 | Headline temperature fix | Built 2026-10-28, unreleased |

Everything tracked here but feature 8 is released. The sections below are kept
as a record of how each feature was built and what to watch for.

---

## 3. Temperature trend arrow in the panel

**Goal:** a small up or down arrow next to the panel temperature, showing
whether the next few hours get warmer or colder.

**Design**
- Compare the current temperature with the forecast about 3 hours ahead,
  using the entries `buildHourlyForecast()` in `weatherClient.js` already
  returns. Show the arrow only when the difference is at least ~2 °C (use
  the same threshold in Kelvin; scale it for °F). Show nothing when it's
  roughly flat, so the arrow means something when it appears.
- Put the calculation in `weatherClient.js` as a pure function (e.g.
  `temperatureTrend(info, unit, hoursAhead)` returning `1`, `-1` or `0`),
  next to `findUpcomingPrecipitation()`. Unit-test it in
  `tests/helpers.test.js` with the existing `fakeEntry()`/`fakeInfo()`.
- Render it in `indicator.js` as an `St.Icon` with `pan-up-symbolic`/
  `pan-down-symbolic` (both verified in Adwaita), between `_panelIcon` and
  `_panelLabel` in `_buildUI()`. The review guidelines ban emoji, and this
  should be an icon, not a text arrow. Hide it in every non-`ready` state
  in `_setState()`.
- New schema key `show-trend-in-panel` (b, default **false**: new keys on a
  published extension shouldn't change the panel for existing users). Add a
  `_switchRow` in the Panel group in `prefs.js` and a `case` in
  `_onSettingChanged`.

**Watch out for**
- `get_value_temp()` returns `[valid, value]`. Skip invalid entries, and
  skip the trend when the current temperature is invalid.
- Only show the arrow when `show-text-in-panel` (the temperature) is on;
  an arrow on its own next to the icon means nothing.

**Done when:** tests cover rising, falling, flat and missing data; the
arrow shows in a nested-session screenshot; the checks in `CLAUDE.md`
"Checks before submitting" pass.

---

## 4. Moon phase in the dropdown - done

Shipped as icon + text in the sunrise/sunset row, behind `show-moon-phase`
(default false). Eight bundled symbolic SVGs under `icons/`, named phases in
`helpers.js` (`moonPhaseIndex`/`moonPhaseName`/`moonPhaseIconName`).

Two things the original plan got wrong, both caught before release:

- **The latitude from `get_value_moonphase()` is the moon's, not the
  observer's.** It reads the same worldwide (Sydney and Tallinn both
  returned -17.6 on 2026-09-22), so flipping the icon by its sign would have
  flipped it for everyone at once. The hemisphere mirror uses
  `info.get_location().get_coords()[0]` instead, which is the observer's
  latitude in **degrees** (not radians).
- **Only eight icons are needed, not sixteen.** A mirrored phase is drawn
  exactly like the opposite phase, so south of the equator the icon for
  phase `i` is the one for `(8 - i) % 8`.

Drawing note: the first attempt filled only the lit part, which at the
15px panel size made "waxing gibbous" an indistinguishable egg shape. Every
icon now outlines the whole disc and fills the lit part, so the phase reads
at size and the footprint stays circular.

---

## 5. "Open in GNOME Weather" menu item - dropped

Built 2026-09-22 and removed the same day at the user's request ("please
remove the menu, I don't care about it"). Don't rebuild it without asking.

Kept because it cost real digging: `org.gnome.Weather` is
`DBusActivatable=true`, but `gapplication list-actions org.gnome.Weather`
lists **no actions**, so the app can't be told which city to open. Any
future version of this can only launch the app.

---

## 6. Full translation of all shipped languages - done

Done 2026-10-23, when every `po/*.po` reached **132/132 translated, 0 fuzzy**;
before this, only `pt_BR` was close (96/132) and the other 30 ranged from 2 to
50. Both numbers are as of that date: Estonian arrived the next day and a
string has been added since, so `CLAUDE.md` carries the current count.

**What it covered beyond filling blanks**

- The fuzzy queue was rewritten, not confirmed: `msgmerge` similarity matching
  had produced wrong text, e.g. German `"Current location unavailable"` →
  `"Standorte"`, Japanese `"Pressure"` → `"気温の単位"` (temperature unit).
- Inherited strings were reviewed against the current UI, which turned up
  defects the statistics didn't show:
  - **Trailing colons** in 14 languages (`Umidità:`, `Luchtvochtigheid:`).
    `_renderCurrent()` in `indicator.js` adds no colon, and the same msgids are
    prefs row titles, so these rendered a stray colon in both places.
  - **`%s °K`** in Dutch — Kelvin takes no degree sign.
  - **Compass labels too wide for the panel**: Polish `zach. pd.-zach.`
    (15 chars), Ukrainian `Зх Пд-Зх`, Italian `VAR` → `variabile`. Replaced
    with the standard compact forms for each language.
  - **Wrong compass values**: Russian `NNW` → `ССВ` (that's NNE), European
    Portuguese `NNE` → `NE`, Basque `W` → `AM`, and Danish/Lithuanian/
    Vietnamese 16-point sets where 8 of the 16 were fuzzy duplicates.
  - **Untranslated or inverted strings**: Greek `"Weather"` → `"Weather"`,
    `zh_TW` `"Weather"` → `"氣象設定"` (weather *settings*), `"No weather
    information"` → `"重新載入氣象資訊"` (reload weather info).
  - European Portuguese `", "` was `","` — the detail-row separator lost its
    space.

**How it was done** — terminology grounded against the GNOME catalogs
installed on this machine (`gtk40`, `gnome-shell`, `gnome-control-center-2.0`,
`libadwaita`, `libgweather-4.0`, `org.gnome.Weather`), so shared terms match
the desktop: `Ortungsdienste`, `Aviso legal`, `Mentions légales`, and the
16-point compass abbreviations derived from libgweather's own full names
(German `Nordnordost` → `NNO`, not `NNE`).

**Caveat:** these are unreviewed translations. Each file's `Last-Translator`
header is set to `machine-assisted (unreviewed)` and `README.md` has a
"Translations" section inviting corrections. Arabic keeps the inherited
full-word compass names (`شمال شمال شرقي`, 14 chars) because Arabic has no
settled short form; it only shows in the panel if the opt-in wind-speed
indicator is on.

`scripts/check-po.sh` was added to automate the `$`-style placeholder audit
that `CLAUDE.md`'s "Translation workflow" previously described as a manual
review step.

**Estonian (`et`) added 2026-10-24**, bringing the set to 32. Two decisions
worth not re-litigating:

- **The 16 compass msgids are left as the international letters** (`N`, `NNE`,
  ...), i.e. `msgstr` equal to `msgid`. Estonian has real names for all eight
  points (põhi, kirre, ida, kagu, lõuna, edel, lääs, loode), but Estonian
  reference works list the *international* letters as their abbreviation, and
  the Estonian initials collide - lõuna and lääs both give "L". Localised
  initials would be both ambiguous and wider than the panel allows.
- **Moon phases follow the traditional Estonian eight-phase naming** (`Kuu
  loomine`, `Noorkuu`, `Esimene veerand`, `Kasvav kuu`, `Täiskuu`, `Kahanev
  kuu`, `Viimane veerand`, `Vanakuu`). Note `noorkuu` is used by many
  Estonian speakers for the *new* moon rather than the waxing crescent; the
  mapping here follows the et.wikipedia "Kuu faasid" article text, whose own
  diagram caption contradicts it. This is the first thing a native reviewer
  should check.

Terminology came from the installed Estonian catalogs where one existed
(`libgweather-4.0` for `Teadmata` and the direction names, `gtk40` for
`Litsents`/`Autorid`, `gnome-control-center-2.0` for `Asukoht`, `Loobu`,
`Vaikimisi`, `Üksikasjad`, `Teated`, `org.gnome.Weather` for `Ilmaprognoos`).
Estonian GNOME Weather is only 43 strings upstream, so the weather detail rows
(`Õhuniiskus`, `Õhurõhk`, `Nähtavus`, `Tajutav`) are not GNOME-sourced;
`tajutav temperatuur` is the Estonian weather service's own term for wind
chill.

## 7. Hourly temperature chart - dropped

Built 2026-10-28 and removed the same day at the user's request ("I don't like
the line, you can drop it"), after looking at it in a nested session. Don't
rebuild it without asking.

A line across the hour-by-hour strip as an `St.DrawingArea`, behind a
`show-hourly-chart` key. What it cost to find out, in case anything else in
this dropdown ever needs Cairo drawing:

- **Aligning a drawing with the hourly columns** works by making the
  `St.DrawingArea` a sibling of the hourly row inside one vertical box in the
  `St.ScrollView`. Both then get the same width and origin, so a column's own
  `allocation` is also its x position within the drawing - no recomputing
  column widths from the stylesheet, the drawing scrolls with the row, and it
  follows the layout in RTL with no special case.
- **`min-height` sizes the content box and padding adds to it**: `min-height:
  32px` plus `padding: 5px 0` allocated 42px (measured in a nested session via
  a helper extension logging `chart.allocation`, not assumed).
- **Custom CSS properties work in an extension stylesheet** the way
  `barLevel.js` uses its `-barlevel-*` ones - `themeNode.get_length()` /
  `get_color()` read them, and `color: -st-accent-color` resolves. St logs
  nothing for an unknown `-weather-*` property.
- **Filling the area under a line reads as a progress bar**, which the review
  guidelines name specifically. Most hourly forecasts are flat enough that the
  fill becomes a slab.
- **Normalizing a temperature run to its own min/max exaggerates it** - a
  2-degree evening stretched across the band looks dramatic. A per-unit
  minimum span with the data centred inside it fixes that.

## 8. Headline temperature fix - built, not yet released

The dropdown's 44px headline had shown `apparentString` since the original
extension, so it both contradicted the panel (which shows the real
temperature) and repeated the "Feels like" row immediately to its right -
8 degrees in the panel against 5 in the dropdown, on the same reading.
`_renderCurrent()` in `indicator.js` now uses `tempString` there.

This changes what every existing user sees, so it's worth a line in whatever
accompanies the next upload.

## Release 1.1 - done

Approved by EGO on 2026-10-27, carrying features 1-4 and the 32-language
translation. `version-name` was left at `1.0` on purpose; see `CLAUDE.md`.

The steps, kept for the next release:

1. Run every step of "Checks before submitting" in `CLAUDE.md`, including
   `./scripts/pack.sh && shexli dist/*.zip`.
2. Smoke-test the real session after a log out/in: rain alert (turn it on,
   select a city with rain within 2 hours), scrolling, and the prefs window.
3. Upload `dist/wetter@mlkonrad.github.com.shell-extension.zip` by hand on
   extensions.gnome.org (the user does this; EGO assigns the version number).
4. Record the release in `CLAUDE.md`'s "Published on extensions.gnome.org"
   section.

## Housekeeping (optional)

- ~~**New strings are untranslated.**~~ Resolved 2026-10-23 by feature 6
  below, which took the then-31 languages to 132/132 with no fuzzy entries
  left. `CLAUDE.md` carries the current count.
- **Keep the nested test harness.** The isolated headless setup used to
  test features 1 and 2 (keyfile settings backend, helper extension taking
  screenshots, virtual pointer, cleanup by environment) lived in a session
  scratch dir and is gone. `CLAUDE.md` describes how to rebuild it. If
  features 3-5 need it again, consider committing it as
  `scripts/headless-test.sh` plus a helper extension under `tests/`.
