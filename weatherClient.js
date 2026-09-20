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
