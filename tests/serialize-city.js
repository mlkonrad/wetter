// Prints the GSettings keyfile value for the extension's `city` key, for the
// cities named on the command line. Used by scripts/headless-test.sh to seed
// an isolated session; run it directly to check what a name resolves to:
//
//   gjs -m tests/serialize-city.js Tallinn "Sao Paulo"
//
// Names are matched the way prefs.js's search matches them - accent-folded
// substring, first CITY-level hit with coordinates wins.

import GWeather from 'gi://GWeather';
import System from 'system';

function foldAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function findCity(query) {
    const needle = foldAccents(query.trim().toLowerCase());
    let found = null;

    const walk = location => {
        if (found)
            return;
        if (location.get_level() === GWeather.LocationLevel.CITY && location.has_coords() &&
            foldAccents((location.get_name() ?? '').toLowerCase()).includes(needle)) {
            found = location;
            return;
        }

        let child = location.next_child(null);
        while (child !== null && !found) {
            walk(child);
            child = location.next_child(child);
        }
    };
    walk(GWeather.Location.get_world());
    return found;
}

const serialized = [];
for (const name of ARGV) {
    const city = findCity(name);
    if (!city) {
        printerr(`no city matches "${name}"`);
        System.exit(1);
    }
    printerr(`${name} -> ${city.get_name()}, ${city.get_country_name()}`);
    serialized.push(`<${city.serialize().print(true)}>`);
}

print(`[${serialized.join(', ')}]`);
