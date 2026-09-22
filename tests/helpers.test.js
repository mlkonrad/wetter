// Run with `npm test` (plain gjs, no GNOME Shell needed). Covers the pure
// formatting and forecast-bucketing logic; UI and GeoClue need a real or
// nested Shell session (see scripts/dev-session.sh).

import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import System from 'system';

import {dayName, iconType, localeTime, moonPhaseIconName, moonPhaseIndex, moonPhaseName, realSpeedUnit, realTemperatureUnit, temperatureString, windString} from '../helpers.js';
import {buildForecast, buildHourlyForecast, findUpcomingPrecipitation, precipitationKind, temperatureTrend} from '../weatherClient.js';

const _ = s => s;
let failures = 0;

function check(name, actual, expected) {
    if (actual === expected) {
        print(`ok - ${name}`);
    } else {
        failures++;
        printerr(`not ok - ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function fakeEntry(unix, temp, icon = 'weather-clear') {
    return {
        get_value_update: () => [unix !== null, unix ?? 0],
        get_value_temp: () => [temp !== null, temp ?? 0],
        get_icon_name: () => icon,
        get_humidity: () => '50%',
    };
}

function fakeInfo(entries, currentTemp = null) {
    return {
        get_forecast_list: () => entries,
        get_location: () => ({get_timezone: () => GLib.TimeZone.new_utc()}),
        get_value_temp: () => [currentTemp !== null, currentTemp ?? 0],
    };
}

check('iconType adds -symbolic', iconType('weather-clear', true), 'weather-clear-symbolic');
check('iconType strips -symbolic', iconType('weather-clear-symbolic', false), 'weather-clear');

const morning = GLib.DateTime.new_local(2026, 9, 13, 9, 5, 0);
check('localeTime 12h has no padding', localeTime(morning, '12h'), '9:05 AM');
check('localeTime 24h', localeTime(morning, '24h'), '09:05');

const today = GLib.DateTime.new_local(2026, 9, 13, 15, 0, 0);
check('dayName today', dayName(today, GLib.DateTime.new_local(2026, 9, 13, 18, 0, 0), _), 'Today');
check('dayName tomorrow', dayName(today, GLib.DateTime.new_local(2026, 9, 14, 6, 0, 0), _), 'Tomorrow');
check('dayName weekday', dayName(today, GLib.DateTime.new_local(2026, 9, 16, 12, 0, 0), _), 'Wednesday');

check('temperatureString celsius', temperatureString(GWeather.TemperatureUnit.CENTIGRADE, 15.6, _), '16 °C');
check('windString letters', windString(GWeather.SpeedUnit.KPH, true, 9.26, 12, false, _), 'WSW 9.3 km/h');
check('windString invalid', windString(GWeather.SpeedUnit.KPH, false, 0, -1, false, _), '-');

// org.gnome.GWeather4 defaults every unit to DEFAULT, which the formatters can't label.
const realTemp = realTemperatureUnit(GWeather.TemperatureUnit.DEFAULT);
const realSpeed = realSpeedUnit(GWeather.SpeedUnit.DEFAULT);
check('realTemperatureUnit keeps concrete units', realTemperatureUnit(GWeather.TemperatureUnit.KELVIN), GWeather.TemperatureUnit.KELVIN);
check('realSpeedUnit keeps concrete units', realSpeedUnit(GWeather.SpeedUnit.KNOTS), GWeather.SpeedUnit.KNOTS);
check('DEFAULT temperature unit is labelled', temperatureString(realTemp, 16, _) !== 'Unknown', true);
check('DEFAULT speed unit is labelled', windString(realSpeed, true, 9.26, 12, false, _) !== 'Unknown', true);
check('DEFAULT speed matches GWeather', GWeather.speed_unit_to_string(realSpeed), GWeather.speed_unit_to_string(GWeather.SpeedUnit.DEFAULT));

const midnight = GLib.DateTime.new_utc(2026, 9, 13, 0, 0, 0).to_unix();
const hour = 3600;
const days = buildForecast(fakeInfo([
    fakeEntry(null, null),
    fakeEntry(midnight + 9 * hour, 10, 'weather-fog'),
    fakeEntry(midnight + 15 * hour, 20, 'weather-clear'),
    fakeEntry(midnight + 27 * hour, null),
    fakeEntry(midnight + 36 * hour, 5),
]), GWeather.TemperatureUnit.CENTIGRADE);
check('buildForecast skips placeholder and splits days', days.length, 2);
check('buildForecast min', days[0].minTemp, 10);
check('buildForecast max', days[0].maxTemp, 20);
check('buildForecast prefers afternoon icon', days[0].icon, 'weather-clear');
check('buildForecast ignores invalid temperatures', days[1].minTemp, 5);
check('buildForecast all-invalid day has null temps',
    buildForecast(fakeInfo([fakeEntry(midnight, null)]), GWeather.TemperatureUnit.CENTIGRADE)[0].maxTemp, null);

const now = GLib.DateTime.new_now_utc().to_unix();
check('buildHourlyForecast keeps only future entries',
    buildHourlyForecast(fakeInfo([fakeEntry(now - hour, 1), fakeEntry(now + hour, 2)])).length, 1);

check('precipitationKind rain', precipitationKind('weather-showers'), 'rain');
check('precipitationKind symbolic snow', precipitationKind('weather-snow-symbolic'), 'snow');
check('precipitationKind storm', precipitationKind('weather-storm'), 'storm');
check('precipitationKind dry', precipitationKind('weather-overcast'), null);
check('precipitationKind missing icon', precipitationKind(null), null);

const upcoming = findUpcomingPrecipitation(fakeInfo([
    fakeEntry(now - hour, 1, 'weather-storm'),
    fakeEntry(now + hour, 1, 'weather-overcast'),
    fakeEntry(now + 2 * hour - 60, 1, 'weather-snow'),
    fakeEntry(now + 2 * hour + 60, 1, 'weather-showers'),
]), 2 * hour);
check('findUpcomingPrecipitation skips past and dry hours', upcoming?.kind, 'snow');
check('findUpcomingPrecipitation returns the icon', upcoming?.iconName, 'weather-snow');
check('findUpcomingPrecipitation ignores hours past the lookahead',
    findUpcomingPrecipitation(fakeInfo([fakeEntry(now + 3 * hour, 1, 'weather-showers')]), 2 * hour), null);

// fakeEntry()/fakeInfo() ignore the unit argument, so the numbers below are
// read as already being in whatever unit the call passes.
const C = GWeather.TemperatureUnit.CENTIGRADE;
const F = GWeather.TemperatureUnit.FAHRENHEIT;

check('temperatureTrend rising',
    temperatureTrend(fakeInfo([fakeEntry(now + hour, 12), fakeEntry(now + 3 * hour, 15)], 10), C, 3), 1);
check('temperatureTrend falling',
    temperatureTrend(fakeInfo([fakeEntry(now + hour, 9), fakeEntry(now + 3 * hour, 6)], 10), C, 3), -1);
check('temperatureTrend flat below the threshold',
    temperatureTrend(fakeInfo([fakeEntry(now + 3 * hour, 11)], 10), C, 3), 0);
check('temperatureTrend falls back to the last entry before the mark',
    temperatureTrend(fakeInfo([fakeEntry(now + hour, 14)], 10), C, 3), 1);
check('temperatureTrend skips forecast entries with no temperature',
    temperatureTrend(fakeInfo([fakeEntry(now + 3 * hour, null), fakeEntry(now + 4 * hour, 15)], 10), C, 3), 1);
check('temperatureTrend without a current temperature',
    temperatureTrend(fakeInfo([fakeEntry(now + 3 * hour, 15)]), C, 3), 0);
check('temperatureTrend without a forecast',
    temperatureTrend(fakeInfo([], 10), C, 3), 0);
check('temperatureTrend uses a wider threshold in Fahrenheit',
    temperatureTrend(fakeInfo([fakeEntry(now + 3 * hour, 53)], 50), F, 3), 0);
check('temperatureTrend rising in Fahrenheit',
    temperatureTrend(fakeInfo([fakeEntry(now + 3 * hour, 54)], 50), F, 3), 1);

// Boundaries between the eight 45-degree buckets, which are centred on the
// cardinal phases - so "new moon" straddles 0 and each bucket starts 22.5
// degrees before its name's exact angle.
check('moonPhaseIndex new at 0', moonPhaseIndex(0), 0);
check('moonPhaseIndex still new just under the boundary', moonPhaseIndex(22.4), 0);
check('moonPhaseIndex waxing crescent at 22.5', moonPhaseIndex(22.5), 1);
check('moonPhaseIndex first quarter at 90', moonPhaseIndex(90), 2);
check('moonPhaseIndex waxing gibbous at 138 (live Tallinn value)', moonPhaseIndex(138.07), 3);
check('moonPhaseIndex full at 180', moonPhaseIndex(180), 4);
check('moonPhaseIndex last quarter at 270', moonPhaseIndex(270), 6);
check('moonPhaseIndex wraps back to new at 359.9', moonPhaseIndex(359.9), 0);
check('moonPhaseIndex wraps past 360', moonPhaseIndex(361), 0);
check('moonPhaseIndex handles a negative angle', moonPhaseIndex(-90), 6);

check('moonPhaseName reads the phase', moonPhaseName(138.07, _), 'Waxing gibbous');
check('moonPhaseName at full', moonPhaseName(180, _), 'Full moon');

// South of the equator the lit limb is mirrored, which is drawn exactly like
// the opposite phase - so the same eight icons cover both hemispheres.
check('moonPhaseIconName northern waxing crescent',
    moonPhaseIconName(45, 59.4), 'moon-waxing-crescent-symbolic');
check('moonPhaseIconName southern waxing crescent mirrors to waning art',
    moonPhaseIconName(45, -33.9), 'moon-waning-crescent-symbolic');
check('moonPhaseIconName northern first quarter',
    moonPhaseIconName(90, 59.4), 'moon-first-quarter-symbolic');
check('moonPhaseIconName southern first quarter mirrors to last quarter art',
    moonPhaseIconName(90, -33.9), 'moon-last-quarter-symbolic');
check('moonPhaseIconName full is its own mirror',
    moonPhaseIconName(180, -33.9), 'moon-full-symbolic');
check('moonPhaseIconName new is its own mirror',
    moonPhaseIconName(0, -33.9), 'moon-new-symbolic');

if (failures) {
    printerr(`${failures} test(s) failed`);
    System.exit(1);
}
