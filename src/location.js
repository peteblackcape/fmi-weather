// Resolves which place the forecast is for: the custom place from our own
// settings, or the location chosen in GNOME Weather.

import Gio from 'gi://Gio';

const GNOME_WEATHER_SCHEMA = 'org.gnome.shell.weather';

/**
 * @returns {Gio.Settings|null} the Shell's weather settings, shared with
 *   the GNOME Weather app
 */
export function getGnomeWeatherSettings() {
    const source = Gio.SettingsSchemaSource.get_default();
    if (!source?.lookup(GNOME_WEATHER_SCHEMA, true))
        return null;
    return new Gio.Settings({schema_id: GNOME_WEATHER_SCHEMA});
}

/**
 * Reads the first location from a serialized GWeather.Location list.
 *
 * @param {Gio.Settings|null} settings
 * @returns {{name: string, latitude: number, longitude: number}|null}
 */
export function readGnomeLocation(settings) {
    const locations = settings?.get_value('locations');
    if (!locations || locations.n_children() === 0)
        return null;

    try {
        const [version, serialized] =
            locations.get_child_value(0).get_variant().deepUnpack();
        if (version !== 2)
            return null;

        // (name, code, is-city, [station coordinates], [city coordinates])
        const [name, , , coordinates, cityCoordinates] = serialized.recursiveUnpack();
        const [latitude, longitude] =
            (cityCoordinates.length > 0 ? cityCoordinates : coordinates)[0] ?? [];
        if (latitude === undefined)
            return null;

        return {
            name,
            latitude: latitude * 180 / Math.PI,
            longitude: longitude * 180 / Math.PI,
        };
    } catch (e) {
        console.warn(`FMI Weather: cannot read GNOME location: ${e.message}`);
        return null;
    }
}

/**
 * @param {Gio.Settings} settings the extension settings
 * @param {Gio.Settings|null} gnomeSettings
 * @returns {{key: string, name: string, place?: string, latitude?: number,
 *   longitude?: number}|null}
 */
export function resolveLocation(settings, gnomeSettings) {
    const place = settings.get_string('place').trim();
    if (place)
        return {key: `place:${place.toLowerCase()}`, name: place, place};

    const location = readGnomeLocation(gnomeSettings);
    if (!location)
        return null;
    return {
        key: `gnome:${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`,
        ...location,
    };
}

/**
 * @param {{name: string}} location
 * @returns {string} the place's page on ilmatieteenlaitos.fi
 */
export function forecastPageUrl(location) {
    return `https://www.ilmatieteenlaitos.fi/saa/${encodeURIComponent(location.name.toLowerCase())}`;
}
