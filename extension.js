import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {WeatherIndicator} from './indicator.js';

const PANEL_BOXES = ['center', 'right', 'left'];

export default class WeatherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // First run: with no cities and 'use-current-location' never set,
        // default to the current location. set_boolean() gives the key a
        // user value, so get_user_value() is non-null on every later enable().
        if (this._settings.get_value('city').n_children() === 0 &&
            this._settings.get_user_value('use-current-location') === null) {
            this._settings.set_boolean('use-current-location', true);
            this._settings.set_int('actual-city', -1);
        }

        this._positionChangedId = this._settings.connect(
            'changed::position-in-panel', () => this._createIndicator());
        this._createIndicator();
    }

    disable() {
        this._settings.disconnect(this._positionChangedId);
        this._positionChangedId = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _createIndicator() {
        this._indicator?.destroy();
        this._indicator = new WeatherIndicator(this._settings, () => this.openPreferences(), this.path);

        const box = PANEL_BOXES[this._settings.get_enum('position-in-panel')];
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, box);
    }
}
