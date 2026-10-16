// Client for the Finnish Meteorological Institute open data WFS service.
// See https://en.ilmatieteenlaitos.fi/open-data-manual

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const WFS_URL = 'https://opendata.fmi.fi/wfs';
const STORED_QUERY = 'fmi::forecast::edited::weather::scandinavia::point::simple';
const FORECAST_DAYS = 4;

// FMI parameter name -> property name in a forecast entry
const PARAMETERS = {
    Temperature: 'temperature',
    FeelsLike: 'feelsLike',
    WeatherSymbol3: 'symbol',
    SmartSymbol: 'smartSymbol',
    WindSpeedMS: 'windSpeed',
    WindDirection: 'windDirection',
};

const ELEMENT_RE = new RegExp(
    '<BsWfs:Time>([^<]+)</BsWfs:Time>\\s*' +
    '<BsWfs:ParameterName>([^<]+)</BsWfs:ParameterName>\\s*' +
    '<BsWfs:ParameterValue>([^<]*)</BsWfs:ParameterValue>', 'g');

export class PlaceNotFoundError extends Error {}

export function createSession() {
    return new Soup.Session({
        user_agent: 'fmi-weather-gnome-extension',
        timeout: 20,
    });
}

/**
 * @param {{place?: string, latitude?: number, longitude?: number}} location
 * @returns {string}
 */
export function buildUrl(location) {
    const endTime = GLib.DateTime.new_now_utc().add_days(FORECAST_DAYS);
    const params = {
        service: 'WFS',
        version: '2.0.0',
        request: 'getFeature',
        storedquery_id: STORED_QUERY,
        parameters: Object.keys(PARAMETERS).join(','),
        timestep: '60',
        endtime: endTime.format('%Y-%m-%dT%H:00:00Z'),
    };
    if (location.place)
        params.place = location.place;
    else
        params.latlon = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;

    const query = Object.entries(params)
        .map(([key, value]) => `${key}=${GLib.Uri.escape_string(value, null, false)}`)
        .join('&');
    return `${WFS_URL}?${query}`;
}

/**
 * Parses a "simple" WFS response into hourly entries sorted by time.
 * Times are milliseconds since the epoch; missing values are null.
 *
 * @param {string} xml
 * @returns {object[]}
 */
export function parseForecast(xml) {
    const entries = new Map();
    for (const [, time, name, value] of xml.matchAll(ELEMENT_RE)) {
        const key = PARAMETERS[name];
        if (!key)
            continue;

        let entry = entries.get(time);
        if (!entry) {
            entry = {time: Date.parse(time)};
            entries.set(time, entry);
        }
        const number = parseFloat(value);
        entry[key] = Number.isFinite(number) ? number : null;
    }
    return [...entries.values()].sort((a, b) => a.time - b.time);
}

/**
 * @param {Soup.Session} session
 * @param {{place?: string, latitude?: number, longitude?: number}} location
 * @param {Gio.Cancellable} [cancellable]
 * @returns {Promise<object[]>}
 */
export async function fetchForecast(session, location, cancellable = null) {
    const message = Soup.Message.new('GET', buildUrl(location));
    const bytes = await session.send_and_read_async(
        message, GLib.PRIORITY_DEFAULT, cancellable);
    const body = new TextDecoder().decode(bytes.get_data() ?? new Uint8Array());
    const status = message.get_status();

    if (status === Soup.Status.BAD_REQUEST && body.includes('No locations found'))
        throw new PlaceNotFoundError(`Place not found: ${location.place}`);
    if (status !== Soup.Status.OK)
        throw new Error(`FMI request failed with HTTP ${status}`);

    const entries = parseForecast(body);
    if (entries.length === 0)
        throw new Error('FMI returned an empty forecast');
    return entries;
}
