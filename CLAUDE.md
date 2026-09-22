# gnome-weather dev notes

Fork of [Neroth/gnome-shell-extension-weather](https://github.com/Neroth/gnome-shell-extension-weather),
ported 2026-09-12 from its original ~2013-era `imports.lang`/`Mainloop`/
autotools shape to current GNOME Shell (ESM, `GObject.registerClass`) and
`libgweather-4`, under a new fork identity (`wetter@mlkonrad.github.com`,
originally `gnome-weather@mlkonrad.github.com`).

Planned features and the next release are tracked in `ROADMAP.md`.

## Display name and uuid are "Wetter" - the settings schema is not

2026-09-12: the user-visible name was rebranded to "Wetter - GNOME Weather
Extension" (`metadata.json`'s `name`, the README title, the "Wetter"/"About"
tab titles in `prefs.js`, and the "Wetter Settings" menu item in
`indicator.js`). 2026-09-13, before the EGO submission, it was shortened to
plain **"Wetter"**: EGO requires a fork to have a unique name, and "GNOME
Weather" invites confusion with GNOME's own Weather app. An EGO search that
day found no "Wetter" but eight extensions named "Weather", including the
upstream `weather-extension@xeked.com`.

2026-09-14, still before the first EGO upload, the `uuid` and gettext domain
were renamed too, from `gnome-weather@mlkonrad.github.com` to
`wetter@mlkonrad.github.com` (the `.pot` and every
`locale/*/LC_MESSAGES/*.mo` are named after the domain). EGO ties a listing to
its uuid, so after the first upload the uuid is effectively frozen: a new one
is a separate extension, and existing users stop getting updates.

The GSettings schema id/path was initially left as
`org.gnome.shell.extensions.gnome-weather` /
`/org/gnome/shell/extensions/gnome-weather/` when the uuid was renamed, because
saved settings (cities, units, panel prefs) live at the schema path, not under
the uuid, so a rename would orphan them at the old dconf path.

2026-09-20: the EGO reviewer asked why the schema still said `gnome-weather`
when the extension is called Wetter, so it was renamed to
`org.gnome.shell.extensions.wetter` / `/org/gnome/shell/extensions/wetter/`
(schema file, both `<enum id=...>`s, the `enum=` attributes on
`position-in-panel`/`time-format`, `settings-schema` in `metadata.json`, and
`--schema=` in `scripts/pack.sh`). This was only safe *because* the extension
had never been published: the review happens before the first upload, so no
installed user had settings at the old path. The one real install (this
machine's symlink) was migrated by hand:

```bash
dconf dump /org/gnome/shell/extensions/gnome-weather/ > old.ini
dconf load /org/gnome/shell/extensions/wetter/ < old.ini
```

If the schema ever needs renaming *after* publication, this is not enough -
that needs migration code shipped in `enable()`, not a one-off dconf dump.

## Published on extensions.gnome.org

2026-09-21: EGO approved the first upload, published as version **1.0**.
From here on the extension is public, so the pre-release freedoms above are
gone:

- The uuid `wetter@mlkonrad.github.com` and gettext domain are permanent.
- The schema id/path (`org.gnome.shell.extensions.wetter` /
  `/org/gnome/shell/extensions/wetter/`) is permanent too. Real users have
  settings there, so renaming it, or changing an existing key's type or
  meaning, needs migration code shipped in `enable()`.
- Every upload is a public release to real users, so run the full
  "Checks before submitting" list before each one.

Generic uses of the word "weather" describing content/state - the panel's
placeholder label text (`_panelLabel.text = _('Weather')` in `indicator.js`'s
`no-location`/`loading`/`error` states) and the `WeatherIndicator`/
`WeatherClient` class/file names - were deliberately left as "Weather", not
renamed to "Wetter". Those aren't branding, they're describing the subject
matter, same as how GNOME's own Weather app would still say "weather" in its
own UI regardless of what it's called.

The GitHub repo was renamed from `mlkonrad/gnome-weather` to `mlkonrad/wetter`
to match (`gh repo rename wetter`, which also updated the local `origin`
remote automatically) — GitHub auto-redirects the old URL, so existing
clones/links keep working. This is purely a repo-slug/URL change; it has no
effect on the uuid/schema decision above.

## Local install is a symlink

`~/.local/share/gnome-shell/extensions/wetter@mlkonrad.github.com` is
a **symlink** to this repo (not a copy) — editing files here is editing what
GNOME Shell loads, no separate deploy step.

To reload after a code change (schema changes need the compile step too):

```bash
glib-compile-schemas schemas/ --strict   # only needed after editing schemas/*.xml
gnome-extensions disable wetter@mlkonrad.github.com
gnome-extensions enable wetter@mlkonrad.github.com
```

`schemas/gschemas.compiled` is generated and gitignored — always regenerate
it in place after touching the `.xml` schema.

## GNOME Shell module caching caveat

`disable`/`enable` does not reliably reload changed `extension.js`/
`indicator.js`/`weatherClient.js`/`helpers.js` code in every GNOME Shell
session (observed on Shell 50 — the old module can stay cached even across a
clean disable/enable cycle). If behavior still looks stale after reloading,
a full log out/in is the sure fix — GNOME Shell can't restart in place on
Wayland like it can on X11 (`Alt+F2` → `r`).

`prefs.js` runs in a separate process (`org.gnome.Shell.Extensions`), so
changes there just need the Settings window closed and reopened — no
logout needed, and no cross-contamination with the Shell-process reload
caveat above.

CSS-only changes to `stylesheet.css` are also picked up by the same
`gnome-extensions disable`/`enable` cycle, or a full logout if that proves
unreliable.

## Fast iteration: nested devkit session (no logout needed)

`mutter-devkit` (installed on this machine, package `mutter-devkit`,
matches this machine's Shell 50) lets you spin up a throwaway nested Shell
that reads the same `~/.local/share/gnome-shell/extensions/` symlink and
the same dconf `enabled-extensions` list as the real session, without
touching it:

```bash
./scripts/dev-session.sh
```

This is a one-shot process — after editing JS, kill it (`Ctrl+C` or close
its window) and re-run the script to get a fresh interpreter with the new
code loaded. That's the same "JS can't be unloaded" constraint as the
caveat above; the nested session just makes paying that cost cheap (a few
seconds, not a full logout) instead of expensive. The script also disables
xdg-desktop-portal/Secret Service probing, which otherwise adds ~30s to
every launch. Verified 2026-09-12: the nested shell brings
`wetter@mlkonrad.github.com` straight to `ACTIVE` with no manual
enabling step needed.

Use this for iterating on JS logic and layout. Still fall back to a full
log out/in for anything that depends on the real session specifically
(actual notification daemon, real background apps/indicators, hardware,
lock screen) or if something looks stale in the nested session and you
need to rule out a devkit-specific quirk.

**Another app launched from the nested session lands in it, not on the
real desktop** (verified 2026-09-22): the devkit Shell creates its own
Wayland socket (`wayland-1` alongside the real `wayland-0`) and exports it
to its private bus's activation environment, so a D-Bus-activated app
started on that bus comes up with `WAYLAND_DISPLAY=wayland-1`. So testing
something that launches another app doesn't inherently need a real
session. Note `gapplication launch org.gnome.Weather` on that bus started
the service but never mapped a window, so confirm a window really appeared
rather than assuming the launch succeeded.

Two things that look like debugging shortcuts but aren't available:
`org.gnome.Shell.Eval` returns `(false, '')` (unsafe mode off, and Shell 50
exposes no `UnsafeMode` D-Bus property to flip), and
`org.gnome.Shell.Introspect.GetWindows` returns `AccessDenied`. To inspect
or drive a nested session's UI, go through a helper extension running
inside it, not the bus.

To shut a devkit session down, kill by its **private bus address** - read
`DBUS_SESSION_BUS_ADDRESS` from `/proc/<pid>/environ` of the
`gnome-shell --devkit` process (*not* the `dbus-run-session` wrapper, which
still holds the real session's values), then kill every process whose
environ contains it. It leaves ~30 service processes behind otherwise.

**dconf is shared with the real session, not sandboxed.** `dbus-run-session`
gives the nested Shell its own private message bus, but GSettings still
reads/writes the one real per-user dconf database
(`~/.config/dconf/user`) - there's no `DCONF_PROFILE` override in
`dev-session.sh`. Verified 2026-09-13: toggling a setting in the nested
session's prefs window (`use-current-location`, `actual-city`) showed up
immediately via `dconf read` run *outside* the nested session, against the
real database. Harmless for this extension today (the real session's
already-loaded, stale JS module just clamps an out-of-range `actual-city`
back to a safe index), but don't assume nested-session settings changes are
disposable - they persist into the real session's settings too.

Undoing such a change has a timing trap (2026-09-22): a `dconf reset` issued
while the nested Shell is still shutting down silently doesn't stick - the
key reads back at its old value, and re-running the reset doesn't help
either. A throwaway key written and reset in the same moment *does* work, so
it isn't dconf being unwritable; the dying session flushes its own state
afterwards. Wait until nothing matching the nested Shell is left in `pgrep`,
then reset, then read back to confirm.

To confirm the nested Shell itself (not just "the script ran"), attach to
its private bus rather than eyeballing the window: the script's
`dbus-run-session` wrapper doesn't print its bus address, so capture
`$DBUS_SESSION_BUS_ADDRESS` from inside it (e.g. tee it to a file before
`exec`ing `gnome-shell`) and then `DBUS_SESSION_BUS_ADDRESS=... gnome-extensions
info wetter@mlkonrad.github.com` reports that nested instance's real
`State: ACTIVE`/`INACTIVE`, independent of the real session's.

Headless screenshots do work, with one trick (verified 2026-09-13, Shell
50.4). A plain `org.gnome.Shell.Screenshot.Screenshot` call comes back
`AccessDenied`, because `screenshot.js` only serves callers that own an
allowlisted bus name (`org.gnome.SettingsDaemon.MediaKeys` or
`org.freedesktop.impl.portal.desktop.gnome`). On the nested session's
*private* bus nothing owns `MediaKeys`, so a small gjs script can
`Gio.bus_own_name()` it, wait ~1.5s for the Shell's name watch to catch up,
and then call `Screenshot(false, false, '/abs/path.png')` on that same
connection. The object path is **`/org/gnome/Shell/Screenshot`**, not
`/org/gnome/Shell` - the latter answers, but without that interface, so the
call fails with `UnknownMethod` rather than anything screenshot-related.
Combined with `gnome-shell --headless --wayland
--virtual-monitor 1280x800`, setting the `org.gnome.Shell` `OverviewActive`
D-Bus property to `false` to leave the startup overview, and `gnome-extensions
prefs <uuid>` (the prefs window opens on the nested display), this gives
real screenshots of the panel and the preferences window without a visible
window. Only do this on the nested bus, never the real session's.

## libgweather-4 migration notes

This extension moved from `libgweather-3` to `libgweather-4` as part of the
port. Verified against the actually-installed `libgweather-4.6.0` typelib
(not assumed from older docs/memory of GWeather 3) — some of this is
genuinely non-obvious and easy to get wrong silently:

- Units schema: `org.gnome.GWeather` → `org.gnome.GWeather4` (same key
  names: `temperature-unit`, `speed-unit`, `pressure-unit`,
  `distance-unit`). Read via plain `new Gio.Settings({schema_id:
  'org.gnome.GWeather4'})`, not `this.getSettings()` (that's only for this
  extension's own bundled schema).
- `GWeather.Provider.YR_NO` → `GWeather.Provider.MET_NO`.
- **`GWeather.LocationEntry` (the GTK autocomplete widget) no longer
  exists.** `prefs.js`'s "add city" search is a from-scratch recursive walk
  of `GWeather.Location.get_world()` via `next_child(prev)`, filtered to
  `get_level() === GWeather.LocationLevel.CITY && has_coords()`. Benchmarked
  at ~13,000 world nodes, ~20-40ms per search — fine for live
  search-as-you-type, no index needed.
- `GWeather.Location.get_timezone()` returns a `GLib.TimeZone` **directly**
  now (`get_identifier()`, not the old `get_tzid()`) — don't re-wrap it with
  `GLib.TimeZone.new(...)`. Got this wrong on the first pass; it threw
  `TypeError: ... .get_tzid is not a function` **inside** `_renderCurrent()`,
  after the panel label/icon were already set but before the dropdown's
  detail view was built — which looked like "panel works, dropdown stuck
  loading forever" rather than an obvious crash. If that symptom ever
  recurs (panel updates, dropdown doesn't), check `journalctl --user` for a
  `JS ERROR` first, not just weather-fetch logic.
- `GWeather.Info`'s `application-id` property must be a **valid GLib
  application ID** (dotted components, e.g. `io.github.mlkonrad.wetter`
  — no `@`). Setting it to something uuid-shaped fails
  `g_application_id_is_valid()`'s assertion silently (just logs a GLib
  critical, doesn't throw in JS), which cascades: `set_enabled_providers()`
  and `update()` both also assert on `application_id != NULL` and become
  no-ops — so the extension looks like it's stuck "loading" forever with no
  JS-visible error at all. Verify with
  `Gio.Application.id_is_valid('...')` before changing this constant in
  `weatherClient.js`.
- `GWeather.TemperatureUnit`/`SpeedUnit`/`PressureUnit`/`DistanceUnit` all
  start at **1** (`0` is `INVALID`) and aren't contiguous (e.g.
  `PressureUnit.ATM == 7` with gaps). `prefs.js`'s `Adw.ComboRow`s store
  explicit `[value, label]` pairs per option rather than assuming the
  combo's positional index equals the enum's integer value — don't
  "simplify" that back to a plain label array. General rule: any time a
  `GSettings` enum key backs a picker widget, check the real enum values
  first (`python3 -c "import gi; ..."` or similar) instead of assuming a
  0-based contiguous range.
- The `org.gnome.GWeather4` unit keys all **default to `DEFAULT`** (enum 1),
  a locale-dependent pseudo-unit. `get_value_temp()`/`get_value_wind()`
  accept it and resolve it internally, but a `switch` over concrete units
  doesn't - so until 2026-09-13 `temperatureString()`/`windString()` showed
  "Unknown" for every user who never changed their units. This machine has
  explicit `centigrade`/`kph` set, which hid it. `indicator.js` now resolves
  units via `realTemperatureUnit()`/`realSpeedUnit()` (`helpers.js`) before
  both fetching and formatting. To test the out-of-the-box path, run gjs with
  `GSETTINGS_BACKEND=memory` (every key at its default) under a few `LC_ALL`
  values - en_US resolves to °F/mph, de_DE and en_GB to °C/km/h.
- **`get_value_moonphase()` returns `[valid, degrees, latitude]`, and that
  latitude is the *moon's*, not the observer's** - it reads the same
  everywhere on the planet (Sydney and Tallinn both returned -17.6 on
  2026-09-22). Anything that needs the observer's hemisphere, such as
  mirroring a moon-phase icon, must use
  `info.get_location().get_coords()`, which returns
  `[latitude, longitude]` in **degrees** - no validity flag, and not
  radians.

## Current location (GeoClue), alongside manually-added cities

2026-09-13: added a "Current Location" entry (`currentLocationClient.js`,
new `use-current-location`/`current-location-city` schema keys) that
auto-refreshes via GeoClue2 and sits alongside the manually-added `city`
list rather than replacing it. Verified live in a devkit session: GeoClue
resolved a real fix, `find_nearest_city()` snapped it to a city, and it
round-tripped through GSettings with no `JS ERROR` in the log.

- **First run with nothing to show defaults to current-location, not "no
  location"** - but this is deliberately **not** a gschema default. An
  earlier version of this tried flipping the `use-current-location`/
  `actual-city` defaults to `true`/`-1` directly in the gschema; testing
  that in a devkit session (see below) exposed the flaw: `use-current-location`
  was a brand-new key with no explicit dconf override on this very machine's
  already-installed extension, so the schema default silently turned on
  background GeoClue tracking for an *existing* install too, not just new
  ones - GSettings has no way to distinguish "freshly installed" from
  "installed but never touched this particular key."
  `WeatherExtension.enable()` in `extension.js` now does this as a one-time
  runtime check instead: if `city` is empty **and**
  `settings.get_user_value('use-current-location') === null` (i.e. this
  install has never explicitly set it - true on real first run, false for
  any install that has, even implicitly via this very code path), it calls
  `set_boolean('use-current-location', true)` /`set_int('actual-city', -1)`.
  That `get_user_value()` check is the guard, not a lifecycle flag (the
  review guidelines ban those) - it's structurally one-shot because the
  `set_boolean()` call itself gives the key a permanent explicit value, so
  it reads non-null on every subsequent `enable()` forever after.
- **`actual-city === -1` is the sentinel** for "use current location" -
  chosen over splicing a synthetic entry into the `city` array because the
  key already had no `<range>` restriction (so `-1` was schema-legal for
  free) and `_confirmRemoveCity`'s index-shift logic
  (`if (index < actual) ...`) only ever compares against `[0, length)`, so
  it's structurally immune to the sentinel without any special-casing.
- **`gi://Geoclue` is imported dynamically, only inside
  `CurrentLocationClient.start()`, and nowhere else.** A static top-level
  import (like the other `gi://...` imports in this codebase) would fail
  the *entire* extension's load for anyone without `geoclue-2.0` installed,
  even if they never touch this feature - the dynamic import confines that
  risk to the moment someone actually flips the toggle on.
- **Dedupe by resolved-city identity** (`city.serialize().print(true)`),
  not raw lat/lon, before treating a GeoClue update as a real change - a
  GeoClue fix that jitters a bit but still resolves to the same nearest
  city must not trigger a redundant weather re-fetch. No time-based
  debounce on top of this; `Geoclue.AccuracyLevel.CITY` isn't granular
  enough to flip-flop between nearest cities on sub-city jitter the way
  STREET/EXACT would.
- **`Geoclue.AccuracyLevel.CITY`** was picked deliberately over
  STREET/EXACT - it matches the granularity `find_nearest_city()` resolves
  to anyway, and is less sensitive. Worth knowing: since this GeoClue
  client is created by code running *inside* gnome-shell itself (not a
  separate confined app), consent/attribution shows up as "GNOME Shell"
  rather than this extension by name, and may not prompt at all if
  location access is already granted system-wide (e.g. automatic
  timezone). That's expected GeoClue behavior for in-process Shell
  extensions, not a bug to chase.
- `prefs.js` never talks to GeoClue itself - same boundary as it never
  doing live weather fetches - it only reads the `current-location-city`
  cache the Shell process wrote, so the preferences window can show a name
  without running its own GeoClue client from the wrong process.
- One benign warning worth knowing if you see it again: `Gjs-WARNING
  Type GITypeInfo of property Geoclue.Simple::location does not match
  return type GITypeInfo of getter get_location. Falling back to slow
  path.` - a GI binding quirk in the `Geoclue.Simple` introspection data,
  not a bug in this codebase; GJS's fallback path works correctly (the
  location still resolves).

## Precipitation notifications

2026-09-22: added an opt-in (`notify-precipitation`, default off) alert that
fires when the selected location's hourly forecast has rain, snow or a
thunderstorm starting within the next two hours. Detection lives in
`weatherClient.js` (`precipitationKind()`, `findUpcomingPrecipitation()`),
the notification in `indicator.js`.

- **Forecasts come only from MET Norway.** Probed 2026-09-22 across six
  continents: MET Norway returns ~90 hourly entries everywhere, the OWM
  provider alone returns an empty forecast list, and METAR never has
  forecasts. So coverage is worldwide, but only as good as MET Norway's model.
- **libgweather-4 has no precipitation probability or amount**, only a
  condition per hour. Classification is by **icon name**, not
  `get_value_conditions()`: MET Norway often leaves the conditions unset on
  an hour whose icon is still `weather-showers`. `weather-showers`/`-snow`/
  `-storm` are the only precipitation icons in `libgweather-4.so`'s strings.
- **One notification per spell**: `_inPrecipitationSpell` stays set while
  it's precipitating now or forecast within the lookahead, so a dismissed
  notification isn't re-sent every 30-minute refresh, and one still on screen
  gets its title/body updated in place. `_reload()` resets it (new location).
- **MessageTray destroys a `Source` by itself** once its last notification
  is gone, so `_notificationSource` is created lazily and nulled from its
  `'destroy'` signal. `destroy()` destroys the source, which withdraws every
  notification the indicator sent, so no `'activated'` handler outlives it.
- **A banner stays on screen while the user is idle.** Its 4s timeout only
  starts once there's input (`_userActiveWhileNotificationShown` in
  `messageTray.js`), so in a headless nested session the banner never hides.
  That is Shell behavior, not a re-sent notification.

To test it without touching the real session or dconf, run the nested
headless Shell with `GSETTINGS_BACKEND=keyfile`, `XDG_CONFIG_HOME` and
`XDG_DATA_HOME` pointed at a scratch dir. The keyfile
(`$XDG_CONFIG_HOME/glib-2.0/settings/keyfile`, groups like
`[org/gnome/shell/extensions/wetter]`) can be pre-seeded with
`enabled-extensions`, `welcome-dialog-last-shown-version`, and the cities
from `dconf dump`. Symlink this repo into
`$XDG_DATA_HOME/gnome-shell/extensions/`. A throwaway helper extension next
to it can take screenshots in-process with `Shell.Screenshot`, which avoids
the `MediaKeys` bus-name trick. Pick a city with rain actually forecast
within two hours; `findUpcomingPrecipitation()` runs fine from plain gjs.

## Scroll to switch location

2026-09-22: scrolling over the panel button steps `actual-city` through the
same order as the Locations submenu (Current Location first, when enabled)
and stops at either end rather than wrapping. `Main.osdWindowManager` shows
the city it landed on, since the panel label names no city.

Measured on Shell 50 with a Clutter virtual pointer, which contradicts the
obvious guess:

- **A mouse wheel's discrete UP/DOWN event is the real one**; the SMOOTH
  event next to it is the emulated copy (`FLAG_POINTER_EMULATED`). A touchpad
  (`ScrollSource.FINGER`) sends only real SMOOTH events. So skipping emulated
  events, as `slider.js` does, counts every input exactly once.
- **Touchpad deltas are 1/10 of the finger travel in pixels** (a 2 px virtual
  swipe arrived as 0.2), and a swipe is a long run of them ending in an event
  with `ScrollFinishFlags.VERTICAL`. It moves one city per gesture;
  accumulating the deltas would jump several cities per swipe.

Testing it in the nested session has two traps. Neither was a code bug:

- **`dbus-run-session` doesn't take `gnome-shell` down with it.** Killing
  its PID left four headless Shells running, all with the same test helper
  enabled, all writing to the same log and changing the same keyfile. Kill
  every process whose `/proc/<pid>/environ` has the scratch
  `XDG_CONFIG_HOME`, never by name: `gnome-shell --mode=user` is the real
  session.
- **The first `notify_absolute_motion()` from a new virtual device can be
  dropped**, leaving the pointer off the button so every scroll misses.
  Re-send the motion a moment later, and log `global.get_pointer()`.

## Translation workflow

`po/POTFILES.in` lists the files gettext scans (`helpers.js`, `indicator.js`,
`prefs.js` — `extension.js`/`weatherClient.js` have no translatable
strings). After changing any translatable string:

```bash
cd po
xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ \
  --package-name=wetter --copyright-holder="Wetter contributors" \
  --output=wetter@mlkonrad.github.com.pot --files-from=POTFILES.in \
  --add-comments --no-wrap
for f in *.po; do
  msgmerge --quiet --previous --backup=none --update "$f" wetter@mlkonrad.github.com.pot
done
cd ..
for f in po/*.po; do
  lang=$(basename "$f" .po)
  mkdir -p "locale/$lang/LC_MESSAGES"
  msgfmt "$f" -o "locale/$lang/LC_MESSAGES/wetter@mlkonrad.github.com.mo"
done
```

**Gotcha, verified 2026-09-12**: `msgmerge`'s fuzzy-matching will match a
short new string (e.g. `"km/h"`) against an old *unrelated, longer template*
string that shares a substring (`"$d$s km/h"`), carrying over that old
translation's leftover placeholder tokens verbatim — which would render
literal `%s`/`$d$s` text in the UI if ever confirmed/shipped. `msgfmt`
excludes fuzzy entries from the compiled `.mo` by default (verified
empirically, not assumed), so this isn't a live bug the moment it happens,
but it's a landmine for whoever next reviews the fuzzy queue and trusts a
fluent-looking guess. **After any `msgmerge` run, audit every fuzzy entry
for a placeholder-token mismatch between `msgid` and `msgstr`
(`%s`/`%d`/`$s`/`$d`-style) across all languages** — don't just spot-check
one. Clear (blank + un-fuzzy) any mismatch; leave wording-only fuzzy
matches alone for a human translator.

`--previous` is passed to `msgmerge` so every fuzzy entry keeps a
`#| msgid "..."` comment showing what it was matched from, for easier
manual review later.

## extensions.gnome.org review guidelines

Full guide: https://gjs.guide/extensions/review-guidelines/review-guidelines.html
GNOME also publishes a second, LLM-targeted checklist aimed specifically at
AI coding assistants working on GNOME Shell extensions:
https://gjs.guide/extensions/review-guidelines/best-practices.html
Both are live URLs — fetch fresh rather than trusting this summary to stay
current. Checked clean as of 2026-09-12:

- **Lifecycle discipline**: nothing gets created, connected, or scheduled at
  module scope — only in `enable()`/`_init()`. That includes
  `GWeather.Location.get_world()`: it returns a GObject, so call it inside
  the functions that need it rather than caching it in a module-level
  `const` (it's a cheap cached singleton inside libgweather anyway). Everything created there gets
  torn down in `disable()`/`destroy()` (the timer `GLib.source_remove()`d,
  every settings `connect()` id explicitly disconnected, the `WeatherClient`
  destroyed, instance vars set back to `null`). `WeatherExtension.enable/
  disable` in `extension.js` and `WeatherIndicator.destroy()` in
  `indicator.js` already follow this — keep new state on the same pattern.
- **No deprecated imports**: no `ByteArray`, `Lang`, or `Mainloop`. ESM
  `import`, `GLib.timeout_add_seconds`/`GLib.SOURCE_CONTINUE` natively.
- **Don't mix process libraries**: no `Gtk`/`Gdk`/`Adw` in
  `extension.js`/`indicator.js`/`weatherClient.js`/`currentLocationClient.js`/
  `helpers.js` (Shell process), no `St`/`Clutter`/`Meta` in `prefs.js`
  (separate GTK-only process). `Geoclue` is a plain D-Bus client library
  (no Gtk/Adw/St/Clutter of its own), so `currentLocationClient.js`
  importing it doesn't violate this rule. `prefs.js` deliberately does **not** import `helpers.js` or
  `weatherClient.js`, even though neither actually touches St/Clutter —
  keeping prefs fully self-contained avoids ever having to reason about
  which of its dependencies might one day gain a Shell-process-only import
  (see litsycal's own CLAUDE.md for a real incident of exactly that biting a
  sibling project).
- **No unnecessary try/catch or optional-chaining guards**: no defensive
  padding around guaranteed GObject/GLib methods. The only optional-chaining
  in this codebase (`this._client?.update()`, `this._indicator?.destroy()`,
  etc.) guards a reference that's genuinely nullable by design (not yet
  created, or already torn down), not a method call that can't fail.
- **No lifecycle guard flags**: no `_destroyed`/`_enabled` booleans — instance
  vars are nulled out on cleanup instead.
- **`destroy()` order**: timer removed first, then signals disconnected,
  then `super.destroy()` last. `destroy()` is overridden directly on
  `WeatherIndicator`, not attached via a `'destroy'` signal handler.
- **Icons**: `St.Icon`/`Gtk.Image` throughout, never emoji. No custom
  progress bars.
- **Comments**: no trivial comments restating the next line — every comment
  in this codebase exists to record a non-obvious constraint or a real
  incident (see the libgweather-4 section above for the pattern).
- **Settings pairing**: `settings-schema` in `metadata.json` pairs with a
  parameterless `this.getSettings()` call in both `extension.js` and
  `prefs.js`; the *other* two schemas in play
  (`org.gnome.GWeather4`, `org.gnome.desktop.interface`) are foreign
  system schemas, read via plain `new Gio.Settings({schema_id: '...'})` —
  don't reach for `this.getSettings()` for those.
- **Structural**: `enable()`/`disable()` stay adjacent in `extension.js`;
  logic is split by responsibility (`indicator.js` = panel UI/menu,
  `weatherClient.js` = GWeather.Info lifecycle + forecast bucketing,
  `currentLocationClient.js` = GeoClue lifecycle + nearest-city resolution,
  `helpers.js` = pure formatting, `prefs.js` = settings UI) rather than one
  monolithic file.
- **No `eval`, no minified/obfuscated code, no bundled binaries.**
- **No telemetry**, no clipboard access, no third-party data sharing.
- **Logging**: no `console.log`/`print` in normal operation. There used to
  be a user-toggleable "Debug Logging" setting (`console.debug` gated
  behind a switch) — removed 2026-09-12 at the user's request to keep the
  settings surface minimal; `journalctl --user` already surfaces real
  errors without it. Don't reintroduce a bespoke log file like the original
  2013 extension had (`~/.cache/weather-extension.log`, written on ~80 call
  sites) — that's exactly the kind of noisy logging this guideline flags.
- **metadata.json**: uuid `wetter@mlkonrad.github.com` (own fork
  identity, not the upstream `weather-extension@xeked.com`); `shell-version`
  currently `["49", "50"]` — trim/extend as new Shell versions ship; no
  hand-set `version` key (EGO assigns that on upload).
- **GSettings schema id** stays under `org.gnome.shell.extensions.*` and
  matches the extension's name (`org.gnome.shell.extensions.wetter`) - EGO
  review flags a schema still named after the pre-fork identity.
- **Attribution**: `_renderAttribution()` in `indicator.js` shows
  `GWeather.Info.get_attribution()` whenever it's non-empty. This isn't
  cosmetic — MET Norway's data (one of the three enabled providers,
  alongside METAR and OpenWeatherMap) is CC BY 4.0 licensed and requires
  "appropriate credit... in any reasonable manner." Don't remove this
  outright; it's already styled as a muted footnote
  (`.attribution` in `stylesheet.css`) rather than deleted, since
  `get_attribution()` is provider-aware and automatically returns nothing
  for providers (like METAR) that don't require it.
- **Upload zip: always build it with `./scripts/pack.sh`** (→
  `dist/wetter@mlkonrad.github.com.shell-extension.zip`), never by
  zipping the repo. It ships only runtime files plus `AUTHORS`/`COPYING`
  (as a fork, the original authors' attribution must be distributed);
  `.po`/`.pot`, `package.json`, `eslint.config.js`, `tests/`, `scripts/` and
  `CLAUDE.md` stay out. A new runtime `.js`/asset file must be added there as
  an `--extra-source` or it silently won't ship. **For an asset in a
  subdirectory, pass the directory** (`--extra-source=icons`), not each file:
  `--extra-source=icons/foo.svg` puts `foo.svg` at the zip *root* and silently
  drops the directory (verified 2026-09-22). Because the local install is a
  symlink to this repo, an `icons/...` path lookup keeps working here and
  breaks only for people who install the zip - so `unzip -l dist/*.zip` after
  adding any asset, don't just trust the pack to have done it. Verified 2026-09-13: `shexli`
  on the raw repo reports `node_modules`/`.git`/`.po`/`gschemas.compiled`
  findings, but on the packed zip it's clean - run `shexli dist/*.zip` (not
  `shexli .`, which also crashes on the relative path) before every upload.
  shexli 0.2.1 with `tree-sitter` 0.26.0 segfaults (exit 139) at random,
  sometimes after already printing `clean`. Verified 2026-09-13 in two
  throwaway venvs: `tree-sitter==0.25.2` ran clean 5/5, 0.26.0 crashed 5/5.
  A 139 is a tool crash, not a finding.
  Shell 50's `gnome-extensions pack` segfaults if `--out-dir` doesn't exist
  yet, hence the script's `mkdir -p`.
- Code must be genuinely functional, not stubs — true throughout; this was
  a from-scratch API port, not new placeholder code.

## Coding standards (matches litsycal's)

- ESM only, `GObject.registerClass` for GObject subclasses, arrow functions,
  `const`/`let` — never the original's `Lang.Class`/`arguments[0]`/C-style
  `return 0` idioms.
- Max ~200-char lines.
- Modules split by single responsibility (see Structural bullet above);
  keep new logic in the module that already owns that concern rather than
  growing `indicator.js` into a monolith again.
- Prefer reusing an existing pattern in this repo over inventing a new one
  - e.g. `_enumRow`/`_boolChoiceRow`/`_switchRow` in `prefs.js` for any new
  settings row, the `[value, label]` pair pattern for any new GSettings-enum
  picker, `GLib.timeout_add_seconds` + tracked id + `GLib.source_remove()`
  in `destroy()` for any new periodic task.
- When touching GWeather/GLib APIs whose behavior isn't already proven
  elsewhere in this codebase, verify against the actually-installed typelib
  (`python3 -c "import gi; gi.require_version('GWeather', '4.0'); ..."`)
  before writing code against assumed semantics - this file exists because
  three separate assumptions turned out wrong on the first pass (timezone
  return type, application-id format, unit enum numbering).
- `St.BoxLayout`: use `orientation: Clutter.Orientation.VERTICAL`, not
  `vertical: true` (deprecated since Shell 48, may be removed). A nested
  Shell run with `G_ENABLE_DIAGNOSTIC=1` logs deprecated property use, but
  the other enabled extensions on this machine trigger the same warnings,
  so grep this repo before blaming it.

## Checks before submitting

`npm run lint` (ESLint, GNOME config), `npm test` (plain-gjs tests in
`tests/` for `helpers.js` and forecast bucketing - no Shell needed), then
`./scripts/pack.sh && shexli dist/*.zip`. For a runtime smoke test without
touching the real session, run `dbus-run-session -- gnome-shell --headless
--wayland --virtual-monitor 1280x800`; `gnome-extensions info
wetter@mlkonrad.github.com` on that private bus should report
`State: ACTIVE`, and its log should have no `JS ERROR`. That doesn't
exercise `prefs.js` - open the real preferences window for that.
