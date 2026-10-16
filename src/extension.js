import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {createSession, fetchForecast, PlaceNotFoundError} from './fmi.js';
import {isNight, summarize} from './forecast.js';
import {forecastPageUrl, getGnomeWeatherSettings, resolveLocation} from './location.js';
import {lookupSymbol} from './symbols.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const UPDATE_INTERVAL = 15 * 60; // seconds
const FIRST_RETRY = 60; // seconds, doubled after each failure
const HOUR_COLUMNS = 6;
const DAY_ROWS = 3;
const SECONDARY_OPACITY = 170;
const STALE_OPACITY = 120;

// Arrows point where the wind blows to; FMI gives where it blows from.
const WIND_ARROWS = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];

function formatTemperature(value) {
    if (value === null || value === undefined)
        return '–';
    const rounded = Math.round(value);
    return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)}°`;
}

function formatTime(time, format) {
    return GLib.DateTime.new_from_unix_local(Math.floor(time / 1000)).format(format).trim();
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

const WeatherIndicator = GObject.registerClass(
class WeatherIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, _('Weather'));

        this._extension = extension;
        this._settings = extension.getSettings();
        this._gnomeSettings = getGnomeWeatherSettings();
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._session = createSession();
        this._cancellable = new Gio.Cancellable();
        this._fetchCancellable = null;
        this._timeoutId = 0;
        this._cacheFile = Gio.File.new_for_path(GLib.build_filenamev(
            [GLib.get_user_cache_dir(), extension.uuid, 'forecast.json']));

        this._location = resolveLocation(this._settings, this._gnomeSettings);
        this._data = null; // {key, fetchedAt, entries}
        this._error = null; // null, 'offline' or 'not-found'
        this._retryDelay = FIRST_RETRY;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._panelIcon = new St.Icon({
            icon_name: 'weather-overcast-symbolic',
            style_class: 'system-status-icon',
        });
        this._panelLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._panelIcon);
        box.add_child(this._panelLabel);
        this.add_child(box);

        this._buildMenu();

        this._settings.connectObject(
            'changed::place', () => this._onLocationChanged(),
            'changed::show-temperature', () => this._render(),
            this);
        this._gnomeSettings?.connectObject(
            'changed::locations', () => this._onLocationChanged(), this);
        this._interfaceSettings.connectObject(
            'changed::clock-format', () => this._render(), this);
        Gio.NetworkMonitor.get_default().connectObject('network-changed',
            (monitor, available) => {
                if (available && this._error === 'offline')
                    this._scheduleUpdate(5);
            }, this);
        this.menu.connectObject('open-state-changed', (menu, open) => {
            if (open)
                this._onMenuOpened();
        }, this);

        this._render();
        this._start();
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('fmi-weather-menu');

        // Message shown instead of the forecast, e.g. when loading
        this._messageItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._messageItem);

        this._settingsItem = new PopupMenu.PopupMenuItem(_('Set Location…'));
        this._settingsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(this._settingsItem);

        this._forecastSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._forecastSection);

        // Location and current weather
        const currentItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const currentBox = new St.BoxLayout({
            style_class: 'fmi-weather-current',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._locationLabel = new St.Label({style_class: 'fmi-weather-location'});
        currentBox.add_child(this._locationLabel);

        const nowBox = new St.BoxLayout({style_class: 'fmi-weather-now'});
        this._currentIcon = new St.Icon({
            style_class: 'fmi-weather-current-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._currentTemperature = new St.Label({
            style_class: 'fmi-weather-current-temperature',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const detailsBox = new St.BoxLayout({
            style_class: 'fmi-weather-details',
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._descriptionLabel = new St.Label();
        this._feelsLikeLabel = new St.Label({opacity: SECONDARY_OPACITY});
        this._windLabel = new St.Label({opacity: SECONDARY_OPACITY});
        detailsBox.add_child(this._descriptionLabel);
        detailsBox.add_child(this._feelsLikeLabel);
        detailsBox.add_child(this._windLabel);
        nowBox.add_child(this._currentIcon);
        nowBox.add_child(this._currentTemperature);
        nowBox.add_child(detailsBox);
        currentBox.add_child(nowBox);
        currentItem.add_child(currentBox);
        this._forecastSection.addMenuItem(currentItem);

        // Next hours
        const hoursItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const hoursBox = new St.BoxLayout({style_class: 'fmi-weather-hours', x_expand: true});
        this._hourColumns = [];
        for (let i = 0; i < HOUR_COLUMNS; i++) {
            const column = new St.BoxLayout({
                style_class: 'fmi-weather-hour',
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
            });
            const time = new St.Label({
                opacity: SECONDARY_OPACITY,
                x_align: Clutter.ActorAlign.CENTER,
            });
            const icon = new St.Icon({
                style_class: 'fmi-weather-small-icon',
                x_align: Clutter.ActorAlign.CENTER,
            });
            const temperature = new St.Label({x_align: Clutter.ActorAlign.CENTER});
            column.add_child(time);
            column.add_child(icon);
            column.add_child(temperature);
            hoursBox.add_child(column);
            this._hourColumns.push({column, time, icon, temperature});
        }
        hoursItem.add_child(hoursBox);
        this._forecastSection.addMenuItem(hoursItem);

        this._forecastSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Next days
        this._dayRows = [];
        for (let i = 0; i < DAY_ROWS; i++) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            const row = new St.BoxLayout({style_class: 'fmi-weather-day', x_expand: true});
            const name = new St.Label({
                style_class: 'fmi-weather-day-name',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const icon = new St.Icon({
                style_class: 'fmi-weather-small-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const high = new St.Label({
                style_class: 'fmi-weather-day-temperature',
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const low = new St.Label({
                style_class: 'fmi-weather-day-temperature',
                opacity: SECONDARY_OPACITY,
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(name);
            row.add_child(icon);
            row.add_child(high);
            row.add_child(low);
            item.add_child(row);
            this._forecastSection.addMenuItem(item);
            this._dayRows.push({item, name, icon, high, low});
        }

        this._forecastSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Update time and a link to the place's page on ilmatieteenlaitos.fi
        const footerItem = new PopupMenu.PopupBaseMenuItem();
        this._statusLabel = new St.Label({
            style_class: 'fmi-weather-caption',
            opacity: SECONDARY_OPACITY,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        footerItem.add_child(this._statusLabel);
        footerItem.add_child(new St.Label({
            style_class: 'fmi-weather-caption',
            text: 'ilmatieteenlaitos.fi',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        footerItem.connect('activate', () => this._openForecastPage());
        this._forecastSection.addMenuItem(footerItem);
    }

    async _start() {
        await this._loadCache();
        if (this._cancellable.is_cancelled())
            return;

        // Use a recent cached forecast instead of fetching on every login.
        const age = this._data ? (Date.now() - this._data.fetchedAt) / 1000 : Infinity;
        if (age < UPDATE_INTERVAL)
            this._scheduleUpdate(Math.ceil(UPDATE_INTERVAL - age));
        else
            this._update();
    }

    async _update() {
        this._removeTimeout();
        this._fetchCancellable?.cancel();
        this._fetchCancellable = null;

        const location = this._location;
        if (!location) {
            this._render();
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._fetchCancellable = cancellable;
        try {
            const entries = await fetchForecast(this._session, location, cancellable);
            this._data = {key: location.key, fetchedAt: Date.now(), entries};
            this._error = null;
            this._retryDelay = FIRST_RETRY;
            this._scheduleUpdate(UPDATE_INTERVAL);
            this._saveCache();
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return;

            if (e instanceof PlaceNotFoundError) {
                // Retrying will not help; wait for the settings to change.
                this._error = 'not-found';
            } else {
                console.warn(`FMI Weather: ${e.message}`);
                this._error = 'offline';
                this._scheduleUpdate(this._retryDelay);
                this._retryDelay = Math.min(this._retryDelay * 2, UPDATE_INTERVAL);
            }
        } finally {
            if (this._fetchCancellable === cancellable)
                this._fetchCancellable = null;
        }
        this._render();
    }

    _scheduleUpdate(seconds) {
        this._removeTimeout();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timeoutId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _removeTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _onLocationChanged() {
        this._location = resolveLocation(this._settings, this._gnomeSettings);
        if (this._data?.key !== this._location?.key)
            this._data = null;
        this._error = null;
        this._retryDelay = FIRST_RETRY;
        this._render();
        this._update();
    }

    _onMenuOpened() {
        // Timers can be late after suspend, so check the age here too.
        const stale = this._data && Date.now() - this._data.fetchedAt > UPDATE_INTERVAL * 1000;
        if (stale && !this._fetchCancellable)
            this._update();
        this._render();
    }

    async _loadCache() {
        try {
            const [contents] = await this._cacheFile.load_contents_async(this._cancellable);
            const data = JSON.parse(new TextDecoder().decode(contents));
            if (!this._data && data.key === this._location?.key) {
                this._data = data;
                this._render();
            }
        } catch (e) {
            // No cache yet, or it is unreadable; a fetch will replace it.
        }
    }

    async _saveCache() {
        try {
            const dir = this._cacheFile.get_parent();
            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);
            const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this._data)));
            await this._cacheFile.replace_contents_bytes_async(bytes, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable);
        } catch (e) {
            if (!isCancelled(e))
                console.warn(`FMI Weather: cannot save cache: ${e.message}`);
        }
    }

    _openForecastPage() {
        if (!this._location)
            return;
        try {
            Gio.AppInfo.launch_default_for_uri(forecastPageUrl(this._location),
                global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`FMI Weather: cannot open forecast page: ${e.message}`);
        }
    }

    _showMessage(text, {showSettings = false} = {}) {
        this._messageItem.label.text = text;
        this._messageItem.visible = true;
        this._settingsItem.visible = showSettings;
        this._forecastSection.box.visible = false;
        this._panelIcon.icon_name = 'weather-overcast-symbolic';
        this._panelIcon.opacity = STALE_OPACITY;
        this._panelLabel.visible = false;
    }

    _render() {
        const summary = this._data ? summarize(this._data.entries) : null;

        if (!this._location) {
            this._showMessage(_('No location set'), {showSettings: true});
            return;
        }
        if (this._error === 'not-found') {
            this._showMessage(_('Place “%s” not found').replace('%s', this._location.name),
                {showSettings: true});
            return;
        }
        if (!summary) {
            this._showMessage(this._error === 'offline' ? _('No connection') : _('Loading…'));
            return;
        }

        this._messageItem.visible = false;
        this._settingsItem.visible = false;
        this._forecastSection.box.visible = true;

        const offline = this._error === 'offline';
        const twelveHour = this._interfaceSettings.get_string('clock-format') === '12h';
        const {current, hours, days} = summary;
        const currentSymbol = lookupSymbol(current.symbol, isNight(current));

        this._panelIcon.icon_name = currentSymbol.iconName;
        this._panelIcon.opacity = offline ? STALE_OPACITY : 255;
        this._panelLabel.text = formatTemperature(current.temperature);
        this._panelLabel.opacity = offline ? STALE_OPACITY : 255;
        this._panelLabel.visible = this._settings.get_boolean('show-temperature');

        this._forecastSection.box.opacity = offline ? STALE_OPACITY : 255;

        this._locationLabel.text = this._location.name;
        this._currentIcon.icon_name = currentSymbol.iconName;
        this._currentTemperature.text = formatTemperature(current.temperature);
        this._descriptionLabel.text = currentSymbol.description ? _(currentSymbol.description) : '';
        this._feelsLikeLabel.text =
            _('Feels like %s').replace('%s', formatTemperature(current.feelsLike));
        this._feelsLikeLabel.visible = current.feelsLike !== null;
        if (current.windSpeed !== null) {
            const arrow = current.windDirection !== null
                ? ` ${WIND_ARROWS[Math.round(current.windDirection / 45) % 8]}` : '';
            this._windLabel.text =
                _('Wind %s m/s').replace('%s', Math.round(current.windSpeed)) + arrow;
        }
        this._windLabel.visible = current.windSpeed !== null;

        /* Translators: hour in the hourly forecast, see GLib.DateTime.format() */
        const hourFormat = twelveHour ? _('%l %p') : _('%H');
        this._hourColumns.forEach((column, i) => {
            const hour = hours[i];
            column.column.visible = !!hour;
            if (!hour)
                return;
            column.time.text = formatTime(hour.time, hourFormat);
            column.icon.icon_name = lookupSymbol(hour.symbol, isNight(hour)).iconName;
            column.temperature.text = formatTemperature(hour.temperature);
        });

        this._dayRows.forEach((row, i) => {
            const day = days[i];
            row.item.visible = !!day;
            if (!day)
                return;
            row.name.text = capitalize(formatTime(day.time, '%a'));
            row.icon.icon_name = lookupSymbol(day.symbol).iconName;
            row.high.text = formatTemperature(day.high);
            row.low.text = formatTemperature(day.low);
        });

        /* Translators: time of the last update, see GLib.DateTime.format() */
        const updateFormat = twelveHour ? _('%l:%M %p') : _('%H:%M');
        this._statusLabel.text = offline
            ? _('No connection')
            : _('Updated %s').replace('%s', formatTime(this._data.fetchedAt, updateFormat));
    }

    destroy() {
        this._removeTimeout();
        this._fetchCancellable?.cancel();
        this._cancellable.cancel();
        this._session.abort();
        this._settings.disconnectObject(this);
        this._gnomeSettings?.disconnectObject(this);
        this._interfaceSettings.disconnectObject(this);
        Gio.NetworkMonitor.get_default().disconnectObject(this);
        super.destroy();
    }
});

export default class FmiWeatherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settings.connectObject('changed::panel-position', () => {
            this._removeIndicator();
            this._addIndicator();
        }, this);
        this._addIndicator();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._settings = null;
        this._removeIndicator();
    }

    _addIndicator() {
        this._indicator = new WeatherIndicator(this);
        const position = this._settings.get_string('panel-position');
        Main.panel.addToStatusArea(this.uuid, this._indicator,
            position === 'right' ? 0 : -1, position);
    }

    _removeIndicator() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
