// Turns hourly FMI entries into what the menu shows: now, the next hours and
// the next days.

import GLib from 'gi://GLib';

const HOURS = 6;
const DAYS = 3;
const DAY_SYMBOL_HOUR = 13;

function localDateTime(time) {
    return GLib.DateTime.new_from_unix_local(Math.floor(time / 1000));
}

function dayKey(dateTime) {
    return dateTime.format('%F');
}

/**
 * @param {object[]} entries hourly entries from fmi.parseForecast()
 * @param {number} [now] milliseconds since the epoch
 * @returns {{current: object, hours: object[], days: object[]} | null}
 */
export function summarize(entries, now = Date.now()) {
    // The entry for the current hour is the latest one that has started.
    let index = entries.findLastIndex(entry => entry.time <= now);
    if (index === -1)
        index = 0;
    if (index >= entries.length - 1 && entries[index].time + 3600 * 1000 < now)
        return null;

    const current = entries[index];
    const hours = entries.slice(index + 1, index + 1 + HOURS);

    const byDay = new Map();
    for (const entry of entries) {
        const key = dayKey(localDateTime(entry.time));
        if (!byDay.has(key))
            byDay.set(key, []);
        byDay.get(key).push(entry);
    }

    const today = localDateTime(now);
    const days = [];
    for (let offset = 1; offset <= DAYS; offset++) {
        const date = today.add_days(offset);
        const dayEntries = byDay.get(dayKey(date));
        if (!dayEntries)
            break;

        const temperatures = dayEntries
            .map(entry => entry.temperature)
            .filter(value => value !== null);
        const midday = dayEntries.find(
            entry => localDateTime(entry.time).get_hour() === DAY_SYMBOL_HOUR) ??
            dayEntries[Math.floor(dayEntries.length / 2)];

        days.push({
            time: midday.time,
            symbol: midday.symbol,
            high: Math.max(...temperatures),
            low: Math.min(...temperatures),
        });
    }

    return {current, hours, days};
}

/**
 * FMI SmartSymbol values above 100 are night versions of the symbol.
 *
 * @param {object} entry
 * @returns {boolean}
 */
export function isNight(entry) {
    return (entry.smartSymbol ?? 0) > 100;
}
