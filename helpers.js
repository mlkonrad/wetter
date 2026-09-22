import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';

const CONCRETE_SPEED_UNITS = [
    GWeather.SpeedUnit.MS, GWeather.SpeedUnit.KPH, GWeather.SpeedUnit.MPH,
    GWeather.SpeedUnit.KNOTS, GWeather.SpeedUnit.BFT,
];

function windArrows(_) {
    return [
        '', `${_('VAR')} `, '↓ ', '↙ ', '↙ ', '↙ ', '← ', '↖ ', '↖ ', '↖ ',
        '↑ ', '↗ ', '↗ ', '↗ ', '→ ', '↘ ', '↘ ', '↘ ', '- ',
    ];
}

/**
 * Resolves an icon name to its symbolic or full-color variant.
 *
 * @param {string} iconName - a GWeather/freedesktop icon name, symbolic or not
 * @param {boolean} symbolic - whether the symbolic variant should be returned
 * @returns {string} the resolved icon name
 */
export function iconType(iconName, symbolic) {
    if (!iconName)
        return symbolic ? '-symbolic' : '';

    if (iconName.includes('-symbolic'))
        return symbolic ? iconName : iconName.replace('-symbolic', '');

    return symbolic ? `${iconName}-symbolic` : iconName;
}

/**
 * Formats a forecast date relative to today ("Today", "Tomorrow", a weekday,
 * or a full date), capitalized.
 *
 * @param {GLib.DateTime} today - the current local date
 * @param {GLib.DateTime} date - the forecast date to label
 * @param {Function} _ - gettext translation function
 * @returns {string} the relative day label
 */
export function dayName(today, date, _) {
    const oneDay = 86400;
    const startOfToday = GLib.DateTime.new_local(
        today.get_year(), today.get_month(), today.get_day_of_month(), 0, 0, 0);
    const delta = date.to_unix() - startOfToday.to_unix();

    if (delta < 0 && delta > -oneDay)
        return _('Yesterday');
    if (delta >= 0 && delta < oneDay)
        return _('Today');
    if (delta >= oneDay && delta < oneDay * 2)
        return _('Tomorrow');

    const name = delta >= oneDay * 2 && delta < oneDay * 7
        ? date.format('%A') : date.format('%a, %x');
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Formats a time in either 12-hour or 24-hour style.
 *
 * @param {GLib.DateTime} date - the time to format
 * @param {string} clockFormat - '12h' or '24h'
 * @returns {string} the formatted time
 */
export function localeTime(date, clockFormat) {
    return clockFormat === '12h' ? date.format('%-l:%M %p') : date.format('%R');
}

/**
 * Resolves GWeather's locale-dependent DEFAULT temperature unit (the
 * org.gnome.GWeather4 default) to a concrete unit temperatureString() can label.
 *
 * @param {GWeather.TemperatureUnit} unit - a unit from the GWeather settings
 * @returns {GWeather.TemperatureUnit} a concrete unit, never DEFAULT
 */
export function realTemperatureUnit(unit) {
    return GWeather.temperature_unit_to_real(unit);
}

/**
 * Resolves GWeather's locale-dependent DEFAULT speed unit to a concrete unit
 * windString() can label. libgweather has no public speed_unit_to_real(), but
 * speed_unit_to_string() resolves DEFAULT the same way get_value_wind() does.
 *
 * @param {GWeather.SpeedUnit} unit - a unit from the GWeather settings
 * @returns {GWeather.SpeedUnit} a concrete unit, never DEFAULT
 */
export function realSpeedUnit(unit) {
    if (unit !== GWeather.SpeedUnit.DEFAULT)
        return unit;
    const label = GWeather.speed_unit_to_string(unit);
    return CONCRETE_SPEED_UNITS.find(u => GWeather.speed_unit_to_string(u) === label) ?? GWeather.SpeedUnit.KPH;
}

/**
 * Formats a temperature value with its unit suffix.
 *
 * @param {GWeather.TemperatureUnit} unit - the unit `temp` is expressed in
 * @param {number} temp - the temperature value
 * @param {Function} _ - gettext translation function
 * @returns {string} the formatted temperature
 */
export function temperatureString(unit, temp, _) {
    const value = Math.round(temp).toLocaleString();
    switch (unit) {
    case GWeather.TemperatureUnit.FAHRENHEIT:
        return _('%s °F').replace('%s', value);
    case GWeather.TemperatureUnit.CENTIGRADE:
        return _('%s °C').replace('%s', value);
    case GWeather.TemperatureUnit.KELVIN:
        return _('%s K').replace('%s', value);
    default:
        return _('Unknown');
    }
}

/**
 * Formats a wind speed and direction, or '-' if no valid reading exists.
 *
 * @param {GWeather.SpeedUnit} unit - the unit `speed` is expressed in
 * @param {boolean} valid - whether GWeather reported a usable wind reading
 * @param {number} speed - the wind speed value
 * @param {number} directionIndex - GWeather's wind-direction index (-1 for none)
 * @param {boolean} useArrows - show direction as arrows instead of letters
 * @param {Function} _ - gettext translation function
 * @returns {string} the formatted wind string
 */
export function windString(unit, valid, speed, directionIndex, useArrows, _) {
    if (!valid)
        return '-';

    const value = (Math.round(speed * 10) / 10).toLocaleString();
    const direction = (useArrows ? windArrows(_) : windLetters(_))[directionIndex + 1];

    switch (unit) {
    case GWeather.SpeedUnit.KNOTS:
        return _('$d$s knots').replace('$d', direction).replace('$s', value);
    case GWeather.SpeedUnit.MPH:
        return _('$d$s mph').replace('$d', direction).replace('$s', value);
    case GWeather.SpeedUnit.KPH:
        return _('$d$s km/h').replace('$d', direction).replace('$s', value);
    case GWeather.SpeedUnit.MS:
        return _('$d$s m/s').replace('$d', direction).replace('$s', value);
    case GWeather.SpeedUnit.BFT:
        return _('$dBeaufort $s').replace('$d', direction).replace('$s', value);
    default:
        return _('Unknown');
    }
}

function windLetters(_) {
    return [
        '', `${_('VAR')} `, `${_('N')} `, `${_('NNE')} `, `${_('NE')} `, `${_('ENE')} `,
        `${_('E')} `, `${_('ESE')} `, `${_('SE')} `, `${_('SSE')} `, `${_('S')} `,
        `${_('SSW')} `, `${_('SW')} `, `${_('WSW')} `, `${_('W')} `, `${_('WNW')} `,
        `${_('NW')} `, `${_('NNW')} `, '- ',
    ];
}

// Eight named phases, each covering 45 degrees centred on its cardinal point,
// in the order the phase angle runs: 0 new, 90 first quarter, 180 full,
// 270 last quarter.
const MOON_PHASES = [
    'new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous',
    'full', 'waning-gibbous', 'last-quarter', 'waning-crescent',
];

/**
 * Buckets a moon phase angle into one of the eight named phases.
 *
 * @param {number} degrees - phase angle, 0-360 (0 new, 180 full)
 * @returns {number} index into the eight phases, starting at "new moon"
 */
export function moonPhaseIndex(degrees) {
    const wrapped = ((degrees % 360) + 360) % 360;
    return Math.floor((wrapped + 22.5) / 45) % MOON_PHASES.length;
}

/**
 * Names a moon phase angle.
 *
 * @param {number} degrees - phase angle, 0-360
 * @param {Function} _ - gettext translation function
 * @returns {string} the translated phase name
 */
export function moonPhaseName(degrees, _) {
    return [
        _('New moon'), _('Waxing crescent'), _('First quarter'), _('Waxing gibbous'),
        _('Full moon'), _('Waning gibbous'), _('Last quarter'), _('Waning crescent'),
    ][moonPhaseIndex(degrees)];
}

/**
 * Picks the bundled icon for a moon phase as seen from a given latitude.
 *
 * The phase is the same everywhere on the planet, but south of the equator
 * the lit limb appears mirrored - and a mirrored phase is drawn exactly like
 * the opposite phase, so the same eight icons serve both hemispheres. Note
 * this needs the *observer's* latitude: the third value from
 * get_value_moonphase() is the moon's own latitude, identical worldwide
 * (verified 2026-09-22 - Sydney and Tallinn return the same sign).
 *
 * @param {number} degrees - phase angle, 0-360
 * @param {number} latitude - the observer's latitude in degrees
 * @returns {string} icon file base name, without the .svg extension
 */
export function moonPhaseIconName(degrees, latitude) {
    const index = moonPhaseIndex(degrees);
    const mirrored = latitude < 0 ? (MOON_PHASES.length - index) % MOON_PHASES.length : index;
    return `moon-${MOON_PHASES[mirrored]}-symbolic`;
}
