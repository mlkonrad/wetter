import St from 'gi://St';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GWeather from 'gi://GWeather';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {WeatherClient, buildForecast, buildHourlyForecast} from './weatherClient.js';
import {CurrentLocationClient} from './currentLocationClient.js';
import {iconType, dayName, localeTime, realSpeedUnit, realTemperatureUnit, temperatureString, windString} from './helpers.js';

const GWEATHER_SCHEMA = 'org.gnome.GWeather4';
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const REFRESH_INTERVAL_SECONDS = 30 * 60;

// Matches the nick order of the time-format enum in the schema.
const TIME_FORMAT_AUTO = 0;
const TIME_FORMAT_12H = 1;

// Matches the "-1" sentinel documented on the actual-city schema key.
const CURRENT_LOCATION_INDEX = -1;

function unpackCities(settings) {
    const world = GWeather.Location.get_world();
    return settings.get_value('city').deep_unpack().map(v => world.deserialize(v));
}

function getCurrentLocationCity(settings) {
    const world = GWeather.Location.get_world();
    const [entry] = settings.get_value('current-location-city').deep_unpack().map(v => world.deserialize(v));
    return entry ?? null;
}

function setCurrentLocationCity(settings, city) {
    settings.set_value('current-location-city', new GLib.Variant('av', [city.serialize()]));
}

function clamp(index, length) {
    if (length === 0)
        return 0;
    return Math.min(Math.max(index, 0), length - 1);
}

export const WeatherIndicator = GObject.registerClass(
class WeatherIndicator extends PanelMenu.Button {
    _init(settings, openPrefs) {
        super._init(0.25, 'Weather');

        this._settings = settings;
        this._openPrefsFn = openPrefs;
        this._gweatherSettings = new Gio.Settings({schema_id: GWEATHER_SCHEMA});
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});

        this._client = null;
        this._timerId = 0;
        this._locationTracker = null;
        this._networkMonitor = Gio.NetworkMonitor.get_default();

        this._buildUI();

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => this._onSettingChanged(key));
        this._gweatherChangedId = this._gweatherSettings.connect('changed', () => this._refreshReadyDisplay());
        this._interfaceChangedId = this._interfaceSettings.connect('changed::clock-format', () => this._refreshReadyDisplay());
        this._networkChangedId = this._networkMonitor.connect('network-changed', (_m, available) => this._onNetworkChanged(available));

        this._syncCurrentLocationTracking();
        this._reload();
    }

    // ── UI construction ────────────────────────────────────────────────────

    _buildUI() {
        const rtl = this.get_text_direction() === Clutter.TextDirection.RTL;
        this._panelIcon = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            icon_name: 'view-refresh-symbolic',
            style_class: `system-status-icon weather-icon${rtl ? '-rtl' : ''}`,
        });
        this._panelLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, text: _('Weather')});
        this._updatePanelLabelVisibility();

        const topBox = new St.BoxLayout();
        topBox.add_child(this._panelIcon);
        topBox.add_child(this._panelLabel);
        this.add_child(topBox);

        this._hourlyBin = new St.Bin({style_class: 'hourly'});
        this._currentBin = new St.Bin({style_class: 'current'});
        this._forecastBin = new St.Bin({style_class: 'forecast'});
        this._attributionBin = new St.Bin({style_class: 'attribution'});

        this.menu.box.add_child(this._currentBin);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.box.add_child(this._hourlyBin);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.box.add_child(this._forecastBin);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.box.add_child(this._attributionBin);
        this._attributionBin.hide();
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._locationsItem = new PopupMenu.PopupSubMenuMenuItem(_('Locations'));
        this.menu.addMenuItem(this._locationsItem);

        this._reloadItem = new PopupMenu.PopupMenuItem(_('Reload Weather Information'));
        this._reloadItem.connect('activate', () => this._client?.update());
        this._reloadItem.hide();
        this.menu.addMenuItem(this._reloadItem);

        const prefsItem = new PopupMenu.PopupMenuItem(_('Wetter Settings'));
        prefsItem.connect('activate', () => this._openPrefsFn());
        this.menu.addMenuItem(prefsItem);
    }

    // ── Settings plumbing ───────────────────────────────────────────────────

    _onSettingChanged(key) {
        switch (key) {
        case 'city':
        case 'actual-city':
            this._reload();
            break;
        case 'use-current-location':
            this._syncCurrentLocationTracking();
            this._reload();
            break;
        case 'current-location-city':
            // Written by our own tracker callback (_onCurrentLocationResolved),
            // which already calls _reload() itself when this entry is the
            // active selection - ignore the generic 'changed' echo here to
            // avoid a redundant second reload.
            break;
        case 'use-symbolic-icons':
            this._refreshReadyDisplay();
            break;
        case 'show-text-in-panel':
        case 'show-comment-in-panel':
        case 'show-humidity-in-panel':
        case 'show-wind-in-panel':
            this._updatePanelLabelVisibility();
            this._renderCurrent();
            break;
        case 'show-daily-forecast':
        case 'forecast-days':
            this._renderForecast();
            break;
        case 'show-hourly-forecast':
        case 'hourly-forecast-count':
            this._renderHourly();
            break;
        case 'time-format':
            this._renderCurrent();
            this._renderHourly();
            break;
        case 'position-in-panel':
            // handled by the owning extension, which recreates the indicator
            break;
        default:
            this._renderCurrent();
        }
    }

    // The panel label only ever shows text the user asked for (temperature,
    // conditions, humidity, and/or wind) - with all off, it's icon-only in
    // every state, not just once weather data is ready.
    _updatePanelLabelVisibility() {
        this._panelLabel.visible = this._settings.get_boolean('show-text-in-panel') ||
            this._settings.get_boolean('show-comment-in-panel') ||
            this._settings.get_boolean('show-humidity-in-panel') ||
            this._settings.get_boolean('show-wind-in-panel');
    }

    _refreshReadyDisplay() {
        this._renderCurrent();
        this._renderForecast();
        this._renderHourly();
    }

    // Resolves the effective clock format ('12h'/'24h') from the
    // extension's own time-format setting, falling back to the system
    // clock format when it's left on "Automatic".
    _resolveClockFormat() {
        const pref = this._settings.get_enum('time-format');
        if (pref === TIME_FORMAT_AUTO)
            return this._interfaceSettings.get_string('clock-format');
        return pref === TIME_FORMAT_12H ? '12h' : '24h';
    }

    _temperatureUnit() {
        return realTemperatureUnit(this._gweatherSettings.get_enum('temperature-unit'));
    }

    _speedUnit() {
        return realSpeedUnit(this._gweatherSettings.get_enum('speed-unit'));
    }

    _cities() {
        return unpackCities(this._settings);
    }

    _actualCityIndex(cities = this._cities()) {
        return clamp(this._settings.get_int('actual-city'), cities.length);
    }

    // ── Current-location tracking ──────────────────────────────────────────

    // The GeoClue-backed tracker is only (re)created when the setting
    // itself flips, not on every _reload() - restarting it is a fresh D-Bus
    // round trip and it must survive switching selection back and forth
    // between current-location and a manual city.
    _syncCurrentLocationTracking() {
        if (this._settings.get_boolean('use-current-location')) {
            if (!this._locationTracker) {
                this._locationTracker = new CurrentLocationClient(
                    city => this._onCurrentLocationResolved(city),
                    error => this._onCurrentLocationError(error));
                this._locationTracker.start();
            }
        } else {
            this._locationTracker?.destroy();
            this._locationTracker = null;

            // 'use-current-location' just turned off (user toggle, or
            // _onCurrentLocationError below) while it was the active
            // selection - fall back to the first city rather than leaving
            // 'actual-city' stuck on the sentinel, which would make both
            // this dropdown and the prefs window show no (or a stale)
            // selection indicator until something else changes it.
            if (this._settings.get_int('actual-city') === CURRENT_LOCATION_INDEX)
                this._settings.set_int('actual-city', 0);
        }
    }

    _onCurrentLocationResolved(city) {
        setCurrentLocationCity(this._settings, city);
        if (this._settings.get_int('actual-city') === CURRENT_LOCATION_INDEX)
            this._reload();
    }

    // Turning the setting off is what keeps this a one-time notification.
    _onCurrentLocationError(error) {
        console.error(`Wetter: current-location lookup failed: ${error.message}`);
        Main.notify(_('Current location unavailable'),
            _('Turn on Location Services in Settings, then turn Current Location back on in Wetter Settings.'));
        this._settings.set_boolean('use-current-location', false);
    }

    // ── Weather fetching ────────────────────────────────────────────────────

    _reload() {
        this._client?.destroy();
        this._client = null;
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        const cities = this._cities();
        const useCurrentLocation = this._settings.get_boolean('use-current-location');
        this._renderLocations(cities, useCurrentLocation);

        let location;
        if (useCurrentLocation && this._settings.get_int('actual-city') === CURRENT_LOCATION_INDEX) {
            location = getCurrentLocationCity(this._settings);
            if (!location) {
                this._setState('detecting');
                return;
            }
        } else {
            if (!cities.length) {
                this._setState('no-location');
                return;
            }
            location = cities[this._actualCityIndex(cities)];
        }

        this._setState('loading');

        this._client = new WeatherClient(location, () => this._renderReady());
        this._reloadItem.show();
        this._client.update();

        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
            this._client?.update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _setState(state) {
        this._state = state;
        this._hourlyBin.hide();
        this._forecastBin.hide();
        this._attributionBin.hide();
        this._reloadItem.hide();

        switch (state) {
        case 'no-location':
            this._setPanelIcon('weather-clear');
            this._panelLabel.text = _('Weather');
            this._currentBin.set_child(new St.Label({text: _('No location configured')}));
            break;
        case 'detecting':
            this._setPanelIcon('view-refresh');
            this._panelLabel.text = _('Weather');
            this._currentBin.set_child(new St.Label({text: _('Detecting your location…')}));
            break;
        case 'loading':
            this._setPanelIcon('view-refresh');
            this._panelLabel.text = _('Weather');
            this._currentBin.set_child(new St.Label({text: _('Loading weather')}));
            break;
        case 'error':
            this._setPanelIcon('weather-severe-alert');
            this._panelLabel.text = _('Weather');
            this._currentBin.set_child(new St.Label({text: _('No weather information')}));
            break;
        }
    }

    // A fetch that fails leaves the panel stuck showing 'error' until the
    // next REFRESH_INTERVAL_SECONDS tick - up to half an hour of "No weather
    // information" after a resume from suspend, where the fetch fires seconds
    // after wake and loses DNS ("Temporary failure in name resolution" from
    // libgweather) while connectivity comes back moments later. Retrying the
    // moment the network is back closes that gap. Moving to 'loading' is what
    // keeps this idempotent across the burst of network-changed signals a
    // single reconnect emits: only the 'error' state arms a retry.
    _onNetworkChanged(available) {
        if (!available || this._state !== 'error' || !this._client)
            return;

        this._setState('loading');
        this._reloadItem.show();
        this._client.update();
    }

    _setPanelIcon(name) {
        this._panelIcon.icon_name = iconType(name, this._settings.get_boolean('use-symbolic-icons'));
    }

    _renderReady() {
        if (!this._client || !this._client.info.is_valid()) {
            this._setState('error');
            return;
        }
        this._state = 'ready';
        this._renderCurrent();
        this._renderHourly();
        this._renderForecast();
        this._renderAttribution();
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    _renderCurrent() {
        if (this._state !== 'ready' || !this._client)
            return;

        const info = this._client.info;
        const symbolic = this._settings.get_boolean('use-symbolic-icons');
        const temperatureUnit = this._temperatureUnit();
        const speedUnit = this._speedUnit();
        const clockFormat = this._resolveClockFormat();
        const conditions = info.get_conditions() === '-' ? info.get_sky() : info.get_conditions();

        this._setPanelIcon(info.get_icon_name());

        // GWeather's get_value_*() accessors return [valid, ...] - not every
        // provider reports every field (e.g. METAR often omits apparent
        // temperature/sunrise/sunset), so each renders as '-' rather than
        // trusting the value when its validity flag is false.
        const [tempValid, tempValue] = info.get_value_temp(temperatureUnit);
        const [apparentValid, apparentValue] = info.get_value_apparent(temperatureUnit);
        const [windValid, windSpeed, windDirection] = info.get_value_wind(speedUnit);

        const tempString = tempValid ? temperatureString(temperatureUnit, tempValue, _) : '-';
        const apparentString = apparentValid ? temperatureString(temperatureUnit, apparentValue, _) : '-';
        const windStr = windString(speedUnit, windValid, windSpeed, windDirection, this._settings.get_boolean('wind-direction'), _);

        const panelParts = [];
        if (this._settings.get_boolean('show-comment-in-panel'))
            panelParts.push(conditions);
        if (this._settings.get_boolean('show-text-in-panel'))
            panelParts.push(tempString);
        if (this._settings.get_boolean('show-humidity-in-panel'))
            panelParts.push(info.get_humidity());
        if (this._settings.get_boolean('show-wind-in-panel'))
            panelParts.push(windStr);
        this._panelLabel.text = panelParts.join(_(', '));

        const icon = new St.Icon({
            icon_size: 72,
            icon_name: iconType(info.get_icon_name(), symbolic),
            style_class: 'weather-current-icon',
        });

        const location = new St.Label({text: `${info.get_location().get_city_name()}${_(', ')}${conditions}`});
        const summary = new St.Label({
            text: apparentString,
            style_class: 'weather-current-summary',
        });

        const tz = info.get_location().get_timezone();
        const [sunriseValid, sunriseTime] = info.get_value_sunrise();
        const [sunsetValid, sunsetTime] = info.get_value_sunset();
        const [updateValid, updateTime] = info.get_value_update();
        const sunrise = sunriseValid ? localeTime(GLib.DateTime.new_from_unix_local(sunriseTime).to_timezone(tz), clockFormat) : '-';
        const sunset = sunsetValid ? localeTime(GLib.DateTime.new_from_unix_local(sunsetTime).to_timezone(tz), clockFormat) : '-';
        const updated = updateValid ? localeTime(GLib.DateTime.new_from_unix_local(updateTime).to_timezone(GLib.TimeZone.new_local()), clockFormat) : '-';

        const infoBox = new St.BoxLayout({style_class: 'weather-current-infobox'});
        infoBox.add_child(new St.Icon({icon_size: 15, icon_name: iconType('weather-clear', symbolic), style_class: 'weather-sunrise-icon'}));
        infoBox.add_child(new St.Label({text: sunrise}));
        infoBox.add_child(new St.Icon({icon_size: 15, icon_name: iconType('weather-clear-night', symbolic), style_class: 'weather-sunset-icon'}));
        infoBox.add_child(new St.Label({text: sunset}));
        infoBox.add_child(new St.Icon({icon_size: 15, icon_name: iconType('view-refresh', symbolic), style_class: 'weather-build-icon'}));
        infoBox.add_child(new St.Label({text: updated}));

        const summaryBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'weather-current-summarybox'});
        summaryBox.add_child(location);
        summaryBox.add_child(summary);
        summaryBox.add_child(infoBox);

        const captions = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'weather-current-databox-captions'});
        const values = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'weather-current-databox-values'});
        const dataBox = new St.BoxLayout({style_class: 'weather-current-databox'});
        dataBox.add_child(captions);
        dataBox.add_child(values);

        const rows = [
            [_('Feels like'), 'show-feels-like', apparentString],
            [_('Visibility'), 'show-visibility', `${info.get_visibility()}`],
            [_('Humidity'), 'show-humidity', info.get_humidity()],
            [_('Pressure'), 'show-pressure', `${info.get_pressure()}`],
            [_('Wind'), 'show-wind', windStr],
        ].filter(([, key]) => this._settings.get_boolean(key));
        for (const [caption, , value] of rows) {
            captions.add_child(new St.Label({text: caption}));
            values.add_child(new St.Label({text: value}));
        }

        const detailBox = new St.BoxLayout();
        detailBox.add_child(summaryBox);
        detailBox.add_child(dataBox);

        const box = new St.BoxLayout({style_class: 'weather-current-iconbox'});
        box.add_child(icon);
        box.add_child(detailBox);
        this._currentBin.set_child(box);
    }

    _renderHourly() {
        if (this._state !== 'ready' || !this._client)
            return;

        if (!this._settings.get_boolean('show-hourly-forecast')) {
            this._hourlyBin.hide();
            return;
        }

        const info = this._client.info;
        const symbolic = this._settings.get_boolean('use-symbolic-icons');
        const temperatureUnit = this._temperatureUnit();
        const clockFormat = this._resolveClockFormat();

        const hours = buildHourlyForecast(info);
        if (!hours.length) {
            this._hourlyBin.hide();
            return;
        }

        const entries = [
            {
                label: _('Now'),
                icon: info.get_icon_name(),
                temp: info.get_value_temp(temperatureUnit),
                humidity: info.get_humidity(),
            },
            // "Now" counts as the first of the total, so only count-1 future hours follow it.
            ...hours.slice(0, this._settings.get_int('hourly-forecast-count') - 1).map(({date, entry}) => ({
                label: localeTime(date, clockFormat),
                icon: entry.get_icon_name(),
                temp: entry.get_value_temp(temperatureUnit),
                humidity: entry.get_humidity(),
            })),
        ];

        const row = new St.BoxLayout();
        for (const item of entries) {
            const [itemTempValid, itemTempValue] = item.temp;
            const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'weather-hourly-box'});
            column.add_child(new St.Label({
                text: itemTempValid ? temperatureString(temperatureUnit, itemTempValue, _) : '-',
                style_class: 'weather-hourly-temp',
            }));
            column.add_child(new St.Icon({
                icon_size: 24,
                icon_name: iconType(item.icon, symbolic),
                style_class: 'weather-hourly-icon',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            column.add_child(new St.Label({text: item.humidity, style_class: 'weather-hourly-humidity'}));
            column.add_child(new St.Label({text: item.label, style_class: 'weather-hourly-time'}));
            row.add_child(column);
        }

        const scroll = new St.ScrollView({
            style_class: 'weather-hourlys',
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
        });
        scroll.add_child(row);

        this._hourlyBin.set_child(scroll);
        this._hourlyBin.show();
    }

    _renderForecast() {
        if (this._state !== 'ready' || !this._client)
            return;

        if (!this._settings.get_boolean('show-daily-forecast')) {
            this._forecastBin.hide();
            return;
        }

        const info = this._client.info;
        const symbolic = this._settings.get_boolean('use-symbolic-icons');
        const temperatureUnit = this._temperatureUnit();
        const days = buildForecast(info, temperatureUnit).slice(0, this._settings.get_int('forecast-days'));
        const today = GLib.DateTime.new_now_local();

        if (!days.length) {
            this._forecastBin.hide();
            return;
        }

        const row = new St.BoxLayout();
        for (const day of days) {
            const icon = new St.Icon({
                icon_size: 32,
                icon_name: iconType(day.icon, symbolic),
                style_class: 'weather-forecast-icon',
            });
            const minmax = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'weather-forecast-minmax'});
            minmax.add_child(new St.Label({
                text: `↑ ${day.maxTemp === null ? '-' : temperatureString(temperatureUnit, day.maxTemp, _)}`,
                style_class: 'weather-forecast-temp-max',
            }));
            minmax.add_child(new St.Label({
                text: `↓ ${day.minTemp === null ? '-' : temperatureString(temperatureUnit, day.minTemp, _)}`,
                style_class: 'weather-forecast-temp-min',
            }));

            const iconMinMax = new St.BoxLayout({style_class: 'weather-forecast-iconminmax'});
            iconMinMax.add_child(icon);
            iconMinMax.add_child(minmax);

            const iconMinMaxBin = new St.Bin({style_class: 'weather-forecast-minmax-box'});
            iconMinMaxBin.set_child(iconMinMax);

            const dayBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'weather-forecast-daybox'});
            dayBox.add_child(new St.Label({text: dayName(today, day.date, _), style_class: 'weather-forecast-day'}));

            const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'weather-forecast-box'});
            column.add_child(iconMinMaxBin);
            column.add_child(dayBox);
            column.add_child(new St.Label({text: day.humidity, style_class: 'weather-forecast-humidity'}));

            row.add_child(column);
        }

        const scroll = new St.ScrollView({
            style_class: 'weather-forecasts',
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
        });
        scroll.add_child(row);

        this._forecastBin.set_child(scroll);
        this._forecastBin.show();
    }

    _renderAttribution() {
        if (this._state !== 'ready' || !this._client) {
            this._attributionBin.hide();
            return;
        }

        const text = (this._client.info.get_attribution() ?? '').replace(/<[^>]+>/g, '');
        if (!text) {
            this._attributionBin.hide();
            return;
        }
        this._attributionBin.set_child(new St.Label({text}));
        this._attributionBin.show();
    }

    _renderLocations(cities, useCurrentLocation) {
        this._locationsItem.menu.removeAll();
        this._locationsItem.visible = cities.length + (useCurrentLocation ? 1 : 0) > 1;

        const actualRaw = this._settings.get_int('actual-city');
        if (useCurrentLocation) {
            const item = new PopupMenu.PopupMenuItem(_('Current Location'));
            if (actualRaw === CURRENT_LOCATION_INDEX)
                item.setOrnament(PopupMenu.Ornament.DOT);
            item.connect('activate', () => this._settings.set_int('actual-city', CURRENT_LOCATION_INDEX));
            this._locationsItem.menu.addMenuItem(item);
        }

        const actual = clamp(actualRaw, cities.length);
        cities.forEach((city, index) => {
            const item = new PopupMenu.PopupMenuItem(city.get_city_name());
            if (actualRaw !== CURRENT_LOCATION_INDEX && index === actual)
                item.setOrnament(PopupMenu.Ornament.DOT);
            item.connect('activate', () => this._settings.set_int('actual-city', index));
            this._locationsItem.menu.addMenuItem(item);
        });
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        this._locationTracker?.destroy();
        this._locationTracker = null;
        this._client?.destroy();
        this._client = null;

        this._settings.disconnect(this._settingsChangedId);
        this._gweatherSettings.disconnect(this._gweatherChangedId);
        this._interfaceSettings.disconnect(this._interfaceChangedId);
        this._networkMonitor.disconnect(this._networkChangedId);
        this._networkMonitor = null;

        super.destroy();
    }
});
