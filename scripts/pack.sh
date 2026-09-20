#!/bin/sh -e
# Builds the zip to upload to extensions.gnome.org into dist/. Only runtime
# files go in: gnome-extensions pack compiles po/*.po into locale/ itself and
# leaves out everything dev-only (CLAUDE.md, node_modules, eslint config, ...).
# AUTHORS/COPYING are included because this is a fork: the original authors'
# attribution has to ship with the code.

cd "$(dirname "$0")/.."

# gnome-extensions pack (Shell 50) segfaults if --out-dir doesn't exist yet.
mkdir -p dist
gnome-extensions pack --force --out-dir=dist \
    --extra-source=indicator.js \
    --extra-source=weatherClient.js \
    --extra-source=currentLocationClient.js \
    --extra-source=helpers.js \
    --extra-source=wetter-logo.svg \
    --extra-source=AUTHORS \
    --extra-source=COPYING \
    --podir=po \
    --schema=schemas/org.gnome.shell.extensions.wetter.gschema.xml
