// FMI WeatherSymbol3 codes mapped to GNOME symbolic icons and descriptions.
// Descriptions are marked for translation and translated by the caller.

const N_ = text => text;

const SYMBOLS = {
    1: ['weather-clear', N_('Clear')],
    2: ['weather-few-clouds', N_('Partly cloudy')],
    3: ['weather-overcast', N_('Cloudy')],
    21: ['weather-showers-scattered', N_('Light showers')],
    22: ['weather-showers-scattered', N_('Showers')],
    23: ['weather-showers', N_('Heavy showers')],
    31: ['weather-showers-scattered', N_('Light rain')],
    32: ['weather-showers', N_('Rain')],
    33: ['weather-showers', N_('Heavy rain')],
    41: ['weather-snow', N_('Light snow showers')],
    42: ['weather-snow', N_('Snow showers')],
    43: ['weather-snow', N_('Heavy snow showers')],
    51: ['weather-snow', N_('Light snowfall')],
    52: ['weather-snow', N_('Snowfall')],
    53: ['weather-snow', N_('Heavy snowfall')],
    61: ['weather-storm', N_('Thundershowers')],
    62: ['weather-storm', N_('Heavy thundershowers')],
    63: ['weather-storm', N_('Thunder')],
    64: ['weather-storm', N_('Heavy thunder')],
    71: ['weather-showers-scattered', N_('Light sleet showers')],
    72: ['weather-showers-scattered', N_('Sleet showers')],
    73: ['weather-showers', N_('Heavy sleet showers')],
    81: ['weather-showers', N_('Light sleet')],
    82: ['weather-showers', N_('Sleet')],
    83: ['weather-showers', N_('Heavy sleet')],
    91: ['weather-fog', N_('Haze')],
    92: ['weather-fog', N_('Fog')],
};

// Only these icons have night variants in the Adwaita icon theme.
const NIGHT_ICONS = new Set(['weather-clear', 'weather-few-clouds']);

/**
 * @param {number|null} code WeatherSymbol3 value
 * @param {boolean} [night]
 * @returns {{iconName: string, description: string}}
 */
export function lookupSymbol(code, night = false) {
    const [icon, description] =
        SYMBOLS[Math.round(code ?? 0)] ?? ['weather-severe-alert', ''];
    const variant = night && NIGHT_ICONS.has(icon) ? '-night' : '';
    return {iconName: `${icon}${variant}-symbolic`, description};
}
