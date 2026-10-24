#!/bin/sh -e
# Launches a nested GNOME Shell (Mutter Development Kit) for testing extension
# changes without logging out of the real session. See CLAUDE.md's "Fast
# iteration" section for why this is needed and what it does/doesn't cover.
#
# Each JS module change still requires killing and re-running this script -
# the JS engine can't unload a loaded module, so a fresh gnome-shell process
# is the only way to pick up new code (same reason a plain disable/enable is
# unreliable on this Shell version, see the module-caching caveat below).

export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all

# Skip xdg-desktop-portal / Secret Service probing, which otherwise adds
# ~30s of startup latency to every single iteration.
DEV_DBUS=/tmp/gnome-weather-dev-dbus
mkdir -p "$DEV_DBUS/dbus-1/services"
cat > "$DEV_DBUS/dbus-1/services/org.freedesktop.secrets.service" <<'EOF'
[D-BUS Service]
Name=org.freedesktop.secrets
Exec=/bin/false
EOF

exec env GTK_A11Y=none ADW_DISABLE_PORTAL=1 \
    XDG_DATA_DIRS="$DEV_DBUS:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
    dbus-run-session -- gnome-shell --devkit --wayland
