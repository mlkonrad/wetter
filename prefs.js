import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';

const GWEATHER_SCHEMA = 'org.gnome.GWeather4';
const SEARCH_RESULT_LIMIT = 30;

// Matches the "-1" sentinel documented on the actual-city schema key.
const CURRENT_LOCATION_INDEX = -1;

// Strips accents/diacritics so e.g. "Sao" matches "São" - typing an accented
// letter is often impractical on a plain keyboard layout.
function foldAccents(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// GWeather 4 dropped the GWeather.LocationEntry widget, so city search is a
// plain recursive walk of the ~13,000-node location tree, which is still fast
// enough to run on every keystroke.
function searchCities(query) {
    const needle = foldAccents(query.trim().toLowerCase());
    if (!needle)
        return [];

    const results = [];
    const walk = location => {
        if (results.length >= SEARCH_RESULT_LIMIT)
            return;
        if (location.get_level() === GWeather.LocationLevel.CITY && location.has_coords() &&
            foldAccents((location.get_name() ?? '').toLowerCase()).includes(needle))
            results.push(location);

        let child = location.next_child(null);
        while (child !== null && results.length < SEARCH_RESULT_LIMIT) {
            walk(child);
            child = location.next_child(child);
        }
    };
    walk(GWeather.Location.get_world());
    return results;
}

function getCities(settings) {
    const world = GWeather.Location.get_world();
    return settings.get_value('city').deep_unpack().map(v => world.deserialize(v));
}

function getCurrentLocationCity(settings) {
    const world = GWeather.Location.get_world();
    const [entry] = settings.get_value('current-location-city').deep_unpack().map(v => world.deserialize(v));
    return entry ?? null;
}

function setCities(settings, cities) {
    settings.set_value('city', new GLib.Variant('av', cities.map(c => c.serialize())));
}

export default class WeatherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(600, 640);

        const settings = this.getSettings();
        const gweatherSettings = new Gio.Settings({schema_id: GWEATHER_SCHEMA});

        const page = new Adw.PreferencesPage({title: _('Wetter'), icon_name: 'preferences-system-symbolic'});
        window.add(page);

        this._buildLocationsGroup(page, window, settings);
        this._buildUnitsGroup(page, window, settings, gweatherSettings);
        this._buildPanelGroup(page, window, settings);
        this._buildDetailsGroup(page, settings);
        this._buildForecastGroup(page, settings);
        this._buildNotificationsGroup(page, settings);
        this._buildAboutPage(window);
    }

    _buildLocationsGroup(page, window, settings) {
        const group = new Adw.PreferencesGroup({title: _('Locations')});
        page.add(group);

        const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
        group.add(list);

        const addButton = new Gtk.Button({icon_name: 'list-add-symbolic', css_classes: ['flat'], valign: Gtk.Align.CENTER});
        group.set_header_suffix(addButton);

        const refresh = () => {
            let row;
            while ((row = list.get_row_at_index(0)))
                list.remove(row);

            const actual = settings.get_int('actual-city');

            const currentLocationRow = new Adw.ActionRow({
                title: _('Current Location'),
                activatable: settings.get_boolean('use-current-location'),
            });
            const cachedCity = getCurrentLocationCity(settings);
            currentLocationRow.subtitle = cachedCity ? cachedCity.get_city_name() : _('Detecting…');
            if (actual === CURRENT_LOCATION_INDEX)
                currentLocationRow.add_prefix(new Gtk.Image({icon_name: 'object-select-symbolic'}));

            const enableSwitch = new Gtk.Switch({
                valign: Gtk.Align.CENTER, active: settings.get_boolean('use-current-location'),
            });
            enableSwitch.connect('notify::active', () => {
                settings.set_boolean('use-current-location', enableSwitch.active);
                if (enableSwitch.active)
                    settings.set_int('actual-city', CURRENT_LOCATION_INDEX);
            });
            currentLocationRow.add_suffix(enableSwitch);
            currentLocationRow.connect('activated', () => settings.set_int('actual-city', CURRENT_LOCATION_INDEX));
            list.append(currentLocationRow);

            const cities = getCities(settings);
            cities.forEach((city, index) => {
                const actionRow = new Adw.ActionRow({title: city.get_city_name(), activatable: true});
                if (index === actual)
                    actionRow.add_prefix(new Gtk.Image({icon_name: 'object-select-symbolic'}));

                const removeButton = new Gtk.Button({
                    icon_name: 'user-trash-symbolic', css_classes: ['flat'], valign: Gtk.Align.CENTER,
                });
                removeButton.connect('clicked', () => this._confirmRemoveCity(window, settings, index));
                actionRow.add_suffix(removeButton);

                actionRow.connect('activated', () => settings.set_int('actual-city', index));
                list.append(actionRow);
            });
        };

        addButton.connect('clicked', () => this._showAddCityDialog(window, settings, refresh));
        for (const key of ['city', 'actual-city', 'use-current-location', 'current-location-city'])
            this._connectSetting(window, settings, key, refresh);
        refresh();
    }

    _showAddCityDialog(window, settings, onAdded) {
        const dialog = new Adw.AlertDialog({heading: _('Add Location')});
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('add', _('Add'));
        dialog.set_response_enabled('add', false);
        dialog.set_default_response('add');

        const search = new Gtk.SearchEntry({placeholder_text: _('Name of the city')});
        const resultsList = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.SINGLE, css_classes: ['boxed-list']});

        const scroller = new Gtk.ScrolledWindow({
            min_content_height: 200, max_content_height: 200, child: resultsList,
        });
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
        box.append(search);
        box.append(scroller);
        dialog.set_extra_child(box);

        let selected = null;
        const addCity = location => {
            const cities = getCities(settings);
            cities.push(location);
            setCities(settings, cities);
            settings.set_int('actual-city', cities.length - 1);
            onAdded();
            dialog.close();
        };

        search.connect('search-changed', () => {
            let row;
            while ((row = resultsList.get_row_at_index(0)))
                resultsList.remove(row);
            selected = null;
            dialog.set_response_enabled('add', false);

            for (const location of searchCities(search.get_text())) {
                const resultRow = new Gtk.ListBoxRow({
                    child: new Gtk.Label({
                        label: [location.get_city_name(), location.get_country_name()].filter(Boolean).join(', '),
                        xalign: 0, margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6,
                    }),
                });
                resultRow.location = location;
                resultsList.append(resultRow);
            }
        });
        resultsList.connect('row-selected', (_l, row) => {
            selected = row?.location ?? null;
            dialog.set_response_enabled('add', selected !== null);
        });
        resultsList.connect('row-activated', (_l, row) => addCity(row.location));

        dialog.connect('response', (_d, response) => {
            if (response === 'add' && selected)
                addCity(selected);
        });

        dialog.present(window);
        search.grab_focus();
    }

    _confirmRemoveCity(window, settings, index) {
        const cities = getCities(settings);
        const city = cities[index];

        const dialog = new Adw.AlertDialog({
            heading: _('Remove Location?'),
            body: _('Remove %s?').replace('%s', city.get_city_name()),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('remove', _('Remove'));
        dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);

        dialog.connect('response', (_d, response) => {
            if (response !== 'remove')
                return;
            cities.splice(index, 1);
            setCities(settings, cities);

            // Keep 'actual-city' pointing at the same city it did before the
            // removal - without this, removing any city ahead of the selected
            // one silently shifts the selection onto a different city.
            const actual = settings.get_int('actual-city');
            if (index < actual)
                settings.set_int('actual-city', actual - 1);
        });

        dialog.present(window);
    }

    _buildUnitsGroup(page, window, settings, gweatherSettings) {
        const group = new Adw.PreferencesGroup({title: _('Units')});
        page.add(group);

        group.add(this._enumRow(window, _('Time Format'), settings, 'time-format', [
            [0, _('Automatic')], [1, _('12-hour')], [2, _('24-hour')],
        ]));

        // GWeather's unit enums start at 1 (0 is INVALID), so options are
        // given as explicit [value, label] pairs rather than assuming the
        // combo row's positional index lines up with the enum's integer value.
        group.add(this._enumRow(window, _('Temperature'), gweatherSettings, 'temperature-unit', [
            [GWeather.TemperatureUnit.DEFAULT, _('Default')],
            [GWeather.TemperatureUnit.KELVIN, _('Kelvin')],
            [GWeather.TemperatureUnit.CENTIGRADE, _('Celsius')],
            [GWeather.TemperatureUnit.FAHRENHEIT, _('Fahrenheit')],
        ]));
        group.add(this._enumRow(window, _('Wind Speed'), gweatherSettings, 'speed-unit', [
            [GWeather.SpeedUnit.DEFAULT, _('Default')],
            [GWeather.SpeedUnit.MS, _('m/s')],
            [GWeather.SpeedUnit.KPH, _('km/h')],
            [GWeather.SpeedUnit.MPH, _('mph')],
            [GWeather.SpeedUnit.KNOTS, _('knots')],
            [GWeather.SpeedUnit.BFT, _('Beaufort')],
        ]));
        group.add(this._enumRow(window, _('Pressure'), gweatherSettings, 'pressure-unit', [
            [GWeather.PressureUnit.DEFAULT, _('Default')],
            [GWeather.PressureUnit.KPA, _('kPa')],
            [GWeather.PressureUnit.HPA, _('hPa')],
            [GWeather.PressureUnit.MB, _('mb')],
            [GWeather.PressureUnit.MM_HG, _('mmHg')],
            [GWeather.PressureUnit.INCH_HG, _('inHg')],
            [GWeather.PressureUnit.ATM, _('atm')],
        ]));
        group.add(this._enumRow(window, _('Distance'), gweatherSettings, 'distance-unit', [
            [GWeather.DistanceUnit.DEFAULT, _('Default')],
            [GWeather.DistanceUnit.METERS, _('m')],
            [GWeather.DistanceUnit.KM, _('km')],
            [GWeather.DistanceUnit.MILES, _('miles')],
        ]));
    }

    _buildPanelGroup(page, window, settings) {
        const group = new Adw.PreferencesGroup({title: _('Panel')});
        page.add(group);

        group.add(this._enumRow(window, _('Position in Panel'), settings, 'position-in-panel', [
            [0, _('Center')], [1, _('Right')], [2, _('Left')],
        ]));
        group.add(this._boolChoiceRow(window, _('Wind Direction'), settings, 'wind-direction',
            [_('Letters'), _('Arrows')]));
        group.add(this._switchRow(_('Symbolic Icons'), settings, 'use-symbolic-icons'));
        group.add(this._switchRow(_('Temperature in Panel'), settings, 'show-text-in-panel'));
        group.add(this._switchRow(_('Temperature Trend in Panel'), settings, 'show-trend-in-panel'));
        group.add(this._switchRow(_('Conditions in Panel'), settings, 'show-comment-in-panel'));
        group.add(this._switchRow(_('Humidity in Panel'), settings, 'show-humidity-in-panel'));
        group.add(this._switchRow(_('Wind Speed in Panel'), settings, 'show-wind-in-panel'));
    }

    _buildDetailsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Details'),
            description: _('Choose which rows appear in the current-conditions view'),
        });
        page.add(group);

        group.add(this._switchRow(_('Feels Like'), settings, 'show-feels-like'));
        group.add(this._switchRow(_('Visibility'), settings, 'show-visibility'));
        group.add(this._switchRow(_('Moon Phase'), settings, 'show-moon-phase'));
        group.add(this._switchRow(_('Humidity'), settings, 'show-humidity'));
        group.add(this._switchRow(_('Pressure'), settings, 'show-pressure'));
        group.add(this._switchRow(_('Wind'), settings, 'show-wind'));
    }

    _buildForecastGroup(page, settings) {
        const group = new Adw.PreferencesGroup({title: _('Forecast')});
        page.add(group);

        group.add(this._switchRow(_('Daily Forecast'), settings, 'show-daily-forecast'));
        group.add(this._spinRow(_('Forecast Days'), settings, 'forecast-days', 1, 10));
        group.add(this._switchRow(_('Hour-by-Hour Forecast'), settings, 'show-hourly-forecast'));
        group.add(this._spinRow(_('Forecast Hours'), settings, 'hourly-forecast-count', 1, 48));
    }

    _buildNotificationsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({title: _('Notifications')});
        page.add(group);

        const row = this._switchRow(_('Rain and Snow Alerts'), settings, 'notify-precipitation');
        row.subtitle = _('Notify when rain, snow or a thunderstorm is forecast within the next two hours');
        group.add(row);
    }

    _buildAboutPage(window) {
        const page = new Adw.PreferencesPage({title: _('About'), icon_name: 'help-about-symbolic'});
        window.add(page);

        const headerGroup = new Adw.PreferencesGroup();
        page.add(headerGroup);

        const header = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 12,
            halign: Gtk.Align.CENTER, margin_top: 12, margin_bottom: 24,
        });
        header.append(new Gtk.Image({
            file: this.dir.get_child('wetter-logo.svg').get_path(), pixel_size: 96,
        }));
        header.append(new Gtk.Label({label: _('Wetter'), css_classes: ['title-1']}));
        header.append(new Gtk.Label({
            label: _('GNOME weather extension with forecasts for multiple locations'),
            css_classes: ['dim-label'], justify: Gtk.Justification.CENTER, wrap: true,
        }));
        headerGroup.add(header);

        const linksGroup = new Adw.PreferencesGroup({title: _('Links')});
        page.add(linksGroup);
        linksGroup.add(this._linkRow(window, _('Source Code'),
            'github.com/mlkonrad/wetter', 'https://github.com/mlkonrad/wetter'));
        linksGroup.add(this._linkRow(window, _('Report an Issue'),
            'github.com/mlkonrad/wetter/issues', 'https://github.com/mlkonrad/wetter/issues'));
        linksGroup.add(this._linkRow(window, 'Buy Me a Coffee',
            _('Help support development'), 'https://buymeacoffee.com/mlkonrad'));

        const legalGroup = new Adw.PreferencesGroup({title: _('Legal')});
        page.add(legalGroup);
        legalGroup.add(this._linkRow(window, _('License'),
            'GPL-3.0-or-later', 'https://www.gnu.org/licenses/gpl-3.0.html'));
        // MET Norway's data is CC BY 4.0, which requires credit "in any reasonable
        // manner" - it's already shown as a footnote in the panel dropdown when the
        // active provider requires it (indicator.js's _renderAttribution()); this is
        // an additional, always-visible credit rather than a replacement for that.
        legalGroup.add(this._linkRow(window, _('Weather Data'),
            _('MET Norway (CC BY 4.0)'), 'https://www.met.no'));

        const creditsGroup = new Adw.PreferencesGroup({title: _('Credits')});
        page.add(creditsGroup);
        creditsGroup.add(new Adw.ActionRow({
            title: _('Contributors'),
            subtitle: [
                'Christian Metzler', 'Elad Alfassa', 'Mark Benjamin', 'Simon Claessens',
                'Ecyrbe', 'Timur Kristóf', 'Simon Legner', 'Mattia Meneguzzo', 'Marlon Konrad',
            ].join(', '),
            subtitle_lines: 0,
            subtitle_selectable: true,
        }));
    }

    _linkRow(window, title, subtitle, uri) {
        const row = new Adw.ActionRow({title, subtitle, activatable: true});
        row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        row.connect('activated', () => new Gtk.UriLauncher({uri}).launch(window, null, null));
        return row;
    }

    _switchRow(title, settings, key) {
        const row = new Adw.SwitchRow({title});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _spinRow(title, settings, key, lower, upper) {
        const row = new Adw.SpinRow({title, adjustment: new Gtk.Adjustment({lower, upper, step_increment: 1})});
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // Unlike settings.bind(), a 'changed' handler isn't released together with
    // the widget it updates, so disconnect it when the window closes.
    _connectSetting(window, settings, key, callback) {
        const id = settings.connect(`changed::${key}`, callback);
        window.connect('close-request', () => {
            settings.disconnect(id);
            return false;
        });
    }

    // options: array of [value, label] pairs; `value` is the actual integer
    // stored/read via settings.get_enum()/set_enum(), independent of the
    // combo row's own positional index.
    _enumRow(window, title, settings, key, options) {
        const model = Gtk.StringList.new(options.map(([, label]) => label));
        const row = new Adw.ComboRow({title, model});
        const indexOf = value => Math.max(0, options.findIndex(([v]) => v === value));

        row.selected = indexOf(settings.get_enum(key));
        row.connect('notify::selected', () => settings.set_enum(key, options[row.selected][0]));
        this._connectSetting(window, settings, key, () => (row.selected = indexOf(settings.get_enum(key))));
        return row;
    }

    // Presents a boolean setting as a two-item choice (used for wind-direction).
    _boolChoiceRow(window, title, settings, key, [falseLabel, trueLabel]) {
        const model = Gtk.StringList.new([falseLabel, trueLabel]);
        const row = new Adw.ComboRow({title, model});

        row.selected = Number(settings.get_boolean(key));
        row.connect('notify::selected', () => settings.set_boolean(key, Boolean(row.selected)));
        this._connectSetting(window, settings, key, () => (row.selected = Number(settings.get_boolean(key))));
        return row;
    }
}
