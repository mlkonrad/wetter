import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';

// Must be a valid GApplication ID (dotted, no '@'). An invalid one only logs a
// critical, after which set_enabled_providers() and update() silently do nothing.
export const APPLICATION_ID = 'io.github.mlkonrad.wetter';
const CONTACT_INFO = 'https://github.com/mlkonrad/wetter';

/**
 * Wraps a GWeather.Info for one location: creation, provider/contact setup,
 * and the "updated" signal.
 */
export class WeatherClient {
    constructor(location, onUpdated) {
        this._info = new GWeather.Info({location});
        this._info.set_application_id(APPLICATION_ID);
        this._info.set_contact_info(CONTACT_INFO);
        this._info.set_enabled_providers(
            GWeather.Provider.METAR | GWeather.Provider.OWM | GWeather.Provider.MET_NO);

        this._updatedId = this._info.connect('updated', () => onUpdated());
    }

    get info() {
        return this._info;
    }

    update() {
        this._info.update();
    }

    destroy() {
        this._info.disconnect(this._updatedId);
        this._info.abort();
        this._info = null;
    }
}

/**
 * Groups a GWeather.Info's flat forecast list into per-day buckets with a
 * representative icon/humidity and min/max temperature, for the forecast
 * strip. Behaviorally identical to the original extension's day-bucketing:
 * pick the representative entry from whichever of afternoon/morning/evening/
 * night has data for that day, preferring afternoon.
 *
 * @param {GWeather.Info} info - the weather info to bucket into days
 * @param {GWeather.TemperatureUnit} temperatureUnit - unit for min/max temps
 * @returns {object[]} per-day buckets with icon/humidity/minTemp/maxTemp/date
 *   (minTemp/maxTemp are null when no entry that day has a valid temperature)
 */
export function buildForecast(info, temperatureUnit) {
    const list = info.get_forecast_list();
    if (!list.length)
        return [];

    const tz = info.get_location().get_timezone();

    const days = [];
    let lastDayOfMonth = null;

    for (const entry of list) {
        if (!entry)
            continue;

        // MET Norway's list leads with a placeholder entry whose time is
        // unset, which would otherwise bucket as a day at the Unix epoch.
        const [updateValid, updateTime] = entry.get_value_update();
        if (!updateValid)
            continue;

        const date = GLib.DateTime.new_from_unix_local(updateTime).to_timezone(tz);
        if (date.get_day_of_month() !== lastDayOfMonth)
            days.push({hours: {}, date, minTemp: null, maxTemp: null});
        lastDayOfMonth = date.get_day_of_month();

        const day = days[days.length - 1];
        const [tempValid, temp] = entry.get_value_temp(temperatureUnit);

        day.hours[date.get_hour()] = entry;
        if (tempValid) {
            day.minTemp = day.minTemp === null ? temp : Math.min(day.minTemp, temp);
            day.maxTemp = day.maxTemp === null ? temp : Math.max(day.maxTemp, temp);
        }
    }

    for (const day of days) {
        const entry = representativeEntry(day.hours);
        day.icon = entry?.get_icon_name() ?? '';
        day.humidity = entry?.get_humidity() ?? '';
    }

    return days;
}

/**
 * Returns a GWeather.Info's flat forecast list filtered down to entries
 * strictly after now, in chronological order, for the hour-by-hour strip.
 * Skips the same invalid placeholder entry buildForecast() does.
 *
 * @param {GWeather.Info} info - the weather info to read the forecast from
 * @returns {object[]} `{date, entry}` pairs in chronological order
 */
export function buildHourlyForecast(info) {
    const list = info.get_forecast_list();
    if (!list.length)
        return [];

    const tz = info.get_location().get_timezone();
    const nowUnix = GLib.DateTime.new_now_utc().to_unix();

    const hours = [];
    for (const entry of list) {
        if (!entry)
            continue;

        const [updateValid, updateTime] = entry.get_value_update();
        if (!updateValid || updateTime <= nowUnix)
            continue;

        hours.push({date: GLib.DateTime.new_from_unix_local(updateTime).to_timezone(tz), entry});
    }
    return hours;
}

// Keyed on the icon rather than get_value_conditions(): MET Norway often
// leaves the conditions unset on an hour whose icon is still weather-showers.
// These three are the only precipitation icons libgweather-4 produces.
const PRECIPITATION_ICONS = {
    'weather-showers': 'rain',
    'weather-snow': 'snow',
    'weather-storm': 'storm',
};

/**
 * Classifies a GWeather icon name as rain, snow or a thunderstorm.
 *
 * @param {string} iconName - a GWeather icon name, symbolic or not
 * @returns {string|null} 'rain', 'snow', 'storm', or null for no precipitation
 */
export function precipitationKind(iconName) {
    return PRECIPITATION_ICONS[(iconName ?? '').replace('-symbolic', '')] ?? null;
}

/**
 * Finds the first forecast hour with precipitation that starts within
 * `withinSeconds` from now.
 *
 * @param {GWeather.Info} info - the weather info to read the forecast from
 * @param {number} withinSeconds - how far ahead to look
 * @returns {object|null} `{date, kind, iconName}` for that hour, or null
 */
export function findUpcomingPrecipitation(info, withinSeconds) {
    const limit = GLib.DateTime.new_now_utc().to_unix() + withinSeconds;
    for (const {date, entry} of buildHourlyForecast(info)) {
        if (date.to_unix() > limit)
            break;
        const iconName = entry.get_icon_name();
        const kind = precipitationKind(iconName);
        if (kind)
            return {date, kind, iconName};
    }
    return null;
}

// Smallest change worth drawing an arrow for, per unit. Anything less reads as
// noise in a forecast model's hourly steps, and an arrow that's always there
// says nothing.
const TREND_THRESHOLDS = {
    [GWeather.TemperatureUnit.FAHRENHEIT]: 3.6,
    [GWeather.TemperatureUnit.CENTIGRADE]: 2,
    [GWeather.TemperatureUnit.KELVIN]: 2,
};

/**
 * Compares the current temperature with the forecast `hoursAhead` from now.
 * Picks the first forecast entry at or after that mark, falling back to the
 * last one available - MET Norway's hourly spacing widens further out, so an
 * exact hit isn't guaranteed.
 *
 * @param {GWeather.Info} info - the weather info to read current + forecast from
 * @param {GWeather.TemperatureUnit} unit - concrete unit (never DEFAULT)
 * @param {number} hoursAhead - how far ahead to compare against
 * @returns {number} 1 warming, -1 cooling, 0 flat or not enough data
 */
export function temperatureTrend(info, unit, hoursAhead) {
    const threshold = TREND_THRESHOLDS[unit];
    if (!threshold)
        return 0;

    const [nowValid, nowTemp] = info.get_value_temp(unit);
    if (!nowValid)
        return 0;

    const mark = GLib.DateTime.new_now_utc().to_unix() + hoursAhead * 3600;
    let later = null;
    for (const {date, entry} of buildHourlyForecast(info)) {
        const [valid, temp] = entry.get_value_temp(unit);
        if (!valid)
            continue;
        later = temp;
        if (date.to_unix() >= mark)
            break;
    }
    if (later === null)
        return 0;

    const delta = later - nowTemp;
    if (Math.abs(delta) < threshold)
        return 0;
    return delta > 0 ? 1 : -1;
}

function representativeEntry(hours) {
    const buckets = [[], [], [], []]; // night, morning, afternoon, evening
    for (const [hour, entry] of Object.entries(hours)) {
        const h = Number(hour);
        if (h < 6)
            buckets[0].push(entry);
        else if (h < 12)
            buckets[1].push(entry);
        else if (h < 18)
            buckets[2].push(entry);
        else
            buckets[3].push(entry);
    }

    // Prefer afternoon, then morning, then evening, then night.
    for (const bucket of [buckets[2], buckets[1], buckets[3], buckets[0]]) {
        if (bucket.length)
            return bucket[Math.floor(bucket.length / 2)];
    }
    return null;
}
