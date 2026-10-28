// Dev-only helper, loaded into the throwaway session scripts/headless-test.sh
// builds. It waits for the real indicator to finish its first fetch, opens the
// dropdown and screenshots it, then writes a status file the script polls -
// the alternative, sleeping a fixed number of seconds and hoping, was the
// flakiest part of doing this by hand.
//
// Shell.Screenshot works here because this runs inside gnome-shell. Calling
// the org.gnome.Shell.Screenshot D-Bus interface from outside would not: it
// only serves callers owning an allowlisted bus name (see CLAUDE.md).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TARGET_UUID = 'wetter@mlkonrad.github.com';

// menu.open() returns before the dropdown has been laid out and painted;
// screenshotting immediately catches it half-built.
const SETTLE_SECONDS = 2;

/** Opens the Wetter dropdown once it has data and screenshots it. */
export default class ScreenshotHelperExtension extends Extension {
    enable() {
        // A headless Shell starts in the overview, which would otherwise be
        // the backdrop of every screenshot.
        Main.overview.hide();

        this._outDir = GLib.getenv('WETTER_TEST_OUT');
        this._timeout = Number(GLib.getenv('WETTER_TEST_TIMEOUT'));
        this._waited = 0;
        this._settleId = 0;
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._poll());
    }

    disable() {
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
        if (this._settleId)
            GLib.source_remove(this._settleId);
        this._settleId = 0;
    }

    _poll() {
        this._waited++;
        const indicator = Main.panel.statusArea[TARGET_UUID];

        // _state is the indicator's own private field. This helper ships in the
        // same repo and is released with it, so reading it is a cheaper and
        // steadier readiness signal than guessing from the rendered pixels.
        if (indicator?._state === 'ready') {
            this._pollId = 0;
            indicator.menu.open();
            this._settleId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SETTLE_SECONDS, () => {
                this._settleId = 0;
                this._screenshot();
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        }

        if (this._waited >= this._timeout) {
            this._pollId = 0;
            this._report('timeout', `indicator state was "${indicator?._state}" after ${this._timeout}s`);
            return GLib.SOURCE_REMOVE;
        }

        return GLib.SOURCE_CONTINUE;
    }

    _screenshot() {
        const path = `${this._outDir}/menu.png`;
        const stream = Gio.File.new_for_path(path)
            .replace(null, false, Gio.FileCreateFlags.NONE, null);

        new Shell.Screenshot().screenshot(false, stream, (shooter, result) => {
            shooter.screenshot_finish(result);
            stream.close(null);
            this._report('ok', path);
        });
    }

    // The script waits on this file rather than on the png, so a run that
    // never got that far ends in a reported failure instead of a hang.
    _report(status, detail) {
        console.log(`WETTER-TEST ${status}: ${detail}`);
        Gio.File.new_for_path(`${this._outDir}/status`).replace_contents(
            new TextEncoder().encode(`${status}\n${detail}\n`),
            null, false, Gio.FileCreateFlags.NONE, null);
    }
}
