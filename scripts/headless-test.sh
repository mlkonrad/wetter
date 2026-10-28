#!/bin/sh -e
# Runs this extension in a throwaway GNOME Shell and screenshots its dropdown,
# without touching the real session or the real dconf. See CLAUDE.md's "Fast
# iteration" section for why a nested Shell is the only way to see a JS change,
# and scripts/dev-session.sh for the quick variant that shares your real
# settings.
#
#   ./scripts/headless-test.sh                 # dark, screenshot, exit
#   ./scripts/headless-test.sh --light         # same on the light theme
#   ./scripts/headless-test.sh --city Bergen   # a location of your choosing
#   ./scripts/headless-test.sh --visible       # a window to click around in
#   ./scripts/headless-test.sh --reuse         # keep the last run's settings
#
# --reuse is what tests anything that depends on a previous session having
# happened - the panel's cached reading, say, which only shows on a second
# start.
#
# Isolation comes from GSETTINGS_BACKEND=keyfile plus scratch XDG dirs: every
# GSettings read and write in that Shell goes to a keyfile under $STATE, so
# nothing it does reaches ~/.config/dconf/user. dbus-run-session gives it its
# own bus on top of that.

VARIANT=dark
VISIBLE=no
KEEP=no
REUSE=no
TIMEOUT=60
CITIES=
MONITOR=1400x900

usage() {
    awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
}

while [ $# -gt 0 ]; do
    case "$1" in
    --light) VARIANT=light ;;
    --dark) VARIANT=dark ;;
    --visible) VISIBLE=yes ;;
    --keep) KEEP=yes ;;
    --reuse) REUSE=yes ;;
    --timeout) TIMEOUT=$2; shift ;;
    --city) CITIES="$CITIES $2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 1 ;;
    esac
    shift
done

cd "$(dirname "$0")/.."
REPO=$(pwd)
UUID=wetter@mlkonrad.github.com

STATE="${TMPDIR:-/tmp}/wetter-headless-test"
CONFIG="$STATE/config"
DATA="$STATE/data"
OUT="$STATE/out"
LOG="$STATE/session.log"

# Kill by environment, never by name: `gnome-shell --mode=user` is the real
# session. dbus-run-session does not take its child down with it either, so a
# run that ends badly can leave a whole nested session behind.
cleanup() {
    for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
        # grep opens the file itself so its own 2>/dev/null covers the many
        # /proc entries this user may not read; a shell redirect would not.
        if grep -qzF "XDG_CONFIG_HOME=$CONFIG" "/proc/$pid/environ" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
}

cleanup
if [ "$REUSE" = yes ] && [ -f "$CONFIG/glib-2.0/settings/keyfile" ]; then
    rm -f "$OUT/status" "$OUT/menu.png"
    SEED=no
else
    rm -rf "$STATE"
    SEED=yes
fi
mkdir -p "$CONFIG/glib-2.0/settings" "$DATA/gnome-shell/extensions" "$STATE/cache" "$OUT"

[ -e "$DATA/gnome-shell/extensions/$UUID" ] || ln -s "$REPO" "$DATA/gnome-shell/extensions/$UUID"
ENABLED="'$UUID'"
if [ "$VISIBLE" = no ]; then
    [ -e "$DATA/gnome-shell/extensions/screenshot-helper@wetter.test" ] ||
        ln -s "$REPO/tests/screenshot-helper@wetter.test" "$DATA/gnome-shell/extensions/screenshot-helper@wetter.test"
    ENABLED="$ENABLED, 'screenshot-helper@wetter.test'"
fi

if [ "$SEED" = no ]; then
    echo "reusing the settings from the last run"
fi

COLOR_SCHEME=prefer-light
if [ "$VARIANT" = dark ]; then
    COLOR_SCHEME=prefer-dark
fi

if [ "$SEED" = yes ]; then

# Locations: whatever --city names, else a copy of the real session's list.
# Read-only either way - the copy goes into the scratch keyfile, not back.
if [ -n "$CITIES" ]; then
    # shellcheck disable=SC2086
    CITY_VALUE=$(gjs -m tests/serialize-city.js $CITIES)
else
    CITY_VALUE=$(dconf read "/org/gnome/shell/extensions/wetter/city" || true)
    if [ -z "$CITY_VALUE" ] || [ "$CITY_VALUE" = "@av []" ]; then
        echo "no cities in the real session's settings - pass --city NAME" >&2
        exit 1
    fi
fi

cat > "$CONFIG/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=[$ENABLED]
disable-user-extensions=false
welcome-dialog-last-shown-version='50.0'

[org/gnome/desktop/interface]
clock-format='24h'
color-scheme='$COLOR_SCHEME'

[org/gnome/GWeather4]
temperature-unit='centigrade'
speed-unit='kph'

[org/gnome/shell/extensions/wetter]
actual-city=0
use-current-location=false
city=$CITY_VALUE
EOF

fi

# Same secrets stub scripts/dev-session.sh uses - without it every launch pays
# ~30s of xdg-desktop-portal/Secret Service probing.
DEV_DBUS="$STATE/dbus"
mkdir -p "$DEV_DBUS/dbus-1/services"
cat > "$DEV_DBUS/dbus-1/services/org.freedesktop.secrets.service" <<'EOF'
[D-BUS Service]
Name=org.freedesktop.secrets
Exec=/bin/false
EOF

run_shell() {
    env XDG_CONFIG_HOME="$CONFIG" XDG_DATA_HOME="$DATA" XDG_CACHE_HOME="$STATE/cache" \
        XDG_DATA_DIRS="$DEV_DBUS:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
        GSETTINGS_BACKEND=keyfile GTK_A11Y=none ADW_DISABLE_PORTAL=1 \
        WETTER_TEST_OUT="$OUT" WETTER_TEST_TIMEOUT="$TIMEOUT" \
        dbus-run-session -- gnome-shell "$@"
}

if [ "$VISIBLE" = yes ]; then
    echo "nested session ($VARIANT), settings under $CONFIG - close the window to end it"
    trap cleanup EXIT INT TERM
    run_shell --devkit --wayland
    exit 0
fi

run_shell --headless --wayland --virtual-monitor "$MONITOR" > "$LOG" 2>&1 &

# The helper writes $OUT/status when it has shot the menu or given up, so this
# waits on a real signal rather than a fixed sleep. The extra 30s covers the
# Shell's own startup, which happens before the helper's clock starts.
waited=0
while [ ! -f "$OUT/status" ] && [ "$waited" -lt $((TIMEOUT + 30)) ]; do
    sleep 1
    waited=$((waited + 1))
done

errors=$(grep -c "JS ERROR" "$LOG" || true)
if [ -f "$OUT/status" ]; then
    status=$(sed -n 1p "$OUT/status")
    detail=$(sed -n 2p "$OUT/status")
else
    status=no-status
    detail="the session never reported back - see $LOG"
fi

[ "$KEEP" = yes ] || cleanup

echo "variant:  $VARIANT"
echo "status:   $status ($detail)"
echo "JS ERROR: $errors"
echo "log:      $LOG"
if [ "$KEEP" = yes ]; then
    echo "session left running (--keep); settings under $CONFIG"
fi

[ "$status" = ok ] && [ "$errors" -eq 0 ]
