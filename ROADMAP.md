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
| 9 | Light-theme stylesheet | Built 2026-10-28, unreleased |
| 10 | Quieter dropdown scrollbars | Built 2026-10-28, unreleased |
| 11 | Configurable refresh interval | Built 2026-10-28, unreleased |
| 12 | Cached reading in the panel at startup | Built 2026-10-28, unreleased |
| 13 | Click a forecast day to see its hours | Built 2026-10-28, unreleased |

Everything tracked here but features 8 to 13 is released. The sections below are kept
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

## 9. Light-theme stylesheet - built, not yet released

`stylesheet.css` became a `stylesheet-dark.css` + `stylesheet-light.css`
pair, because its six greys were a hardcoded `#999999` that only worked on a
dark theme. See CLAUDE.md's "Two stylesheets, and only one of them is loaded"
for the loader's lookup order, why the light file imports the dark one, and
the colours.

Measured in a nested session, against the menu background the labels actually
sit on:

| | background | before, `#999999` | after |
|---|---|---|---|
| dark | `#36363a` | 4.22:1 | 5.68:1 (`#b2b2b4`) |
| light | `#fafafb` | **2.73:1** | 5.09:1 (`#6b6b6e`) |

The light figure was the defect: under the 4.5:1 WCAG AA line, on 90%-size
labels, invisible to anyone developing on dark.

---

## 10. Quieter dropdown scrollbars - built, not yet released

The hourly and daily strips each carried an 8px `#727275` rail that, on a
strip only slightly wider than the menu, ran nearly its whole width and read
as a divider. They are now 4px, dimmer, and `overlay_scrollbars: true`.

Three things worth knowing before touching this again:

- **Overlay alone makes it worse.** The bar is drawn over the content, and the
  bottom row of both strips is text - the hour labels and the humidity line -
  so it lands on top of them. The columns carry a 7px `padding-bottom` now,
  which is the empty strip the bar floats in.
- **The theme's `border: 3px solid transparent` on the handle does not slim
  what you see.** A background paints under its border, so the default handle
  is a solid 8px, not the 2px the border suggests. Slimming needs
  `min-height` on the `StScrollBar` itself.
- **Use an opaque handle colour.** At 4px the handle's background is painted
  more than once, and a translucent colour stacks with itself: `rgba(255, 255,
  255, 0.3)` measured as if it were about 0.66 alpha, far brighter than the
  file suggests. Opaque `#5a5a5e`/`#c6c6ca` measure exactly as written.

All of it was measured by sampling pixels out of `scripts/headless-test.sh`
screenshots, which is the only reason the second and third were noticed.

## 11. Configurable refresh interval - built, not yet released

`refresh-interval` (i, minutes, default 30) replaces the hardcoded
`REFRESH_INTERVAL_SECONDS`, with a spin row in a new "Updates" group in
`prefs.js`.

- **The floor is 10 minutes, on purpose.** MET Norway's model produces a new
  forecast about once an hour, so polling faster buys nothing and is poor
  manners towards a free, CC BY licensed source. The reason is in the schema
  key's description, where anyone changing the range will see it.
- **Changing it restarts the timer, it does not reload.** `_startRefreshTimer()`
  is separate from `_reload()`: altering how often to fetch shouldn't itself
  fetch, and what's on screen is still current. It returns early with no
  client, so the `no-location` and `detecting` states stay timer-less.
- Its three strings were translated into all 32 languages on 2026-10-28; see
  the Housekeeping note below for where the terms came from.

---

## 12. Cached reading in the panel at startup - built, not yet released

The panel read "Weather" behind a spinner at every login, for as long as the
session's first fetch took. It now shows the last reading until that fetch
lands, from two keys the extension writes itself - the same arrangement
`current-location-city` already uses, which is why GSettings rather than a
cache file.

- **Stored in Kelvin**, with `temperatureFromKelvin()` in `helpers.js`
  converting at paint time, because the display unit can change between the
  session that wrote the cache and the one that reads it. GWeather only
  converts inside `get_value_temp()`, which needs a live `GWeather.Info`.
- **Paired with the location it belongs to** (`cached-location`), compared with
  `GWeather.Location.equal()`, so a reading is never shown for a city the user
  has since switched away from.
- **Dropped after 24 hours.** Past that it is likelier to mislead than to help,
  and a few seconds of placeholder is the lesser evil. The common case - a
  machine shut down overnight - is well inside it.
- **Icon and temperature only.** Conditions, humidity and wind would each need
  their own cached value for a placeholder that lasts seconds.
- `_onSettingChanged` ignores both keys explicitly. Without that the `default:`
  branch re-renders the dropdown after every fetch writes the cache.

Verified with `scripts/headless-test.sh --reuse`, which was added for this: a
first run logs `start panel="Weather"`, the second `start panel="7 °C"`.

## 13. Click a forecast day to see its hours - built, not yet released

A day in the daily strip is now an `St.Button`; clicking it fills the hourly
strip with that day's hours, clicking it again returns to the hours from now.
The selected day is highlighted - there is no separate heading, the highlight
sits directly above the hours it explains. An accent underline instead of the
fill was tried and turned down; the fill matches how GNOME's own calendar
marks a selected day.

- **`buildForecast()` already bucketed the hours** and threw them away after
  picking a representative entry. Each bucket now keeps `entries`, its
  `{date, entry}` pairs in order; nothing else about the bucketing changed.
- **A selected day ignores `hourly-forecast-count`**, which answers "how far
  ahead from now" - a question picking a day already settles. Expect fewer
  than 24 columns two days out: MET Norway's spacing widens to six-hourly.
- **The days are only buttons when the hourly strip is on**, and the selection
  is ignored when either strip is hidden: with the daily one hidden there is
  no way to clear it, with the hourly one hidden nothing for it to change.
- **Both insets moved from the columns to the row**, for two separate reasons.
  Horizontally, a `:first-child` rule on `.weather-forecast-box` now matches
  the column inside each button rather than the one at the edge of the strip.
  Vertically, the bottom inset is the strip the overlay scrollbar floats in:
  left on the column it sits inside the button, and the selected day's
  background is drawn straight across the scrollbar. That one was only caught
  by looking at a real session - the headless screenshots had it too, and I
  had not noticed.
- `_reload()` clears the selection: the day list is about to be rebuilt, and an
  index into another location's forecast means nothing.

Tested headlessly by emitting `clicked` on a button from the helper, which
covers the handler and the re-render but takes input routing on trust - note
`clicked` on `StButton` carries the button number, so `emit('clicked', 1)`;
emitting it bare throws. **Not yet checked with a real pointer**, in
particular whether a click inside the menu leaves the menu open. The Shell's
own menus hold `St.Button`s that behave, so this is expected to be fine, but
it is the one claim here that rests on precedent rather than on a run.

---

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
- **Translations are complete again.** The three strings the refresh interval
  added (`Updates`, `Refresh Interval`, `Minutes between weather updates`) went
  into all 32 languages on 2026-10-28, back to 136/136 with no fuzzy entries.
  Terms were taken from the catalogs installed on this machine rather than
  invented: `Updates` from `gnome-software`, `Refresh` from `org.gnome.Weather`,
  `Interval` from `gnome-control-center-2.0`, the plural of "minute" from that
  catalog's `%d minute`, and the word for weather from this project's own
  `Weather` and `Reload Weather Information` entries, so the new strings read
  in the same voice as the old ones. Four needed a judgement call rather than a
  lookup: Arabic and Hebrew's plural-form entries give the dual
  (`دقيقة واحدة`, `שתי דקות`), so the general plurals were used instead; Polish
  took `Częstotliwość odświeżania` because GNOME Polish prefers a descriptive
  phrase to `Interwał`; and Estonian has no `gnome-software` catalog, so
  `Uuendused` follows this project's own `Uuendatud`. All 32 keep
  `Last-Translator: machine-assisted (unreviewed)`, which is still accurate.
- ~~**Keep the nested test harness.**~~ Done 2026-10-28, after it had been
  rebuilt by hand once too often: `scripts/headless-test.sh` plus
  `tests/screenshot-helper@wetter.test/` and `tests/serialize-city.js`. See
  CLAUDE.md's "Isolated test session" section. The one piece not carried over
  is the virtual pointer used to test scrolling in feature 2; add it back from
  that section's notes if scroll behaviour needs testing again.
