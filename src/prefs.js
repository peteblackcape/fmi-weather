import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {createSession, fetchForecast, PlaceNotFoundError} from './fmi.js';
import {getGnomeWeatherSettings, readGnomeLocation} from './location.js';

const POSITIONS = ['left', 'center', 'right'];

export default class FmiWeatherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const gnomeSettings = getGnomeWeatherSettings();
        const session = createSession();

        const page = new Adw.PreferencesPage();
        window.add(page);

        // Location
        const locationGroup = new Adw.PreferencesGroup({
            title: _('Location'),
            description: _('By default the forecast follows the location set in GNOME Weather. ' +
                'Set a place to use a more precise location, such as a smaller town.'),
        });
        page.add(locationGroup);

        const gnomeRow = new Adw.ActionRow({title: _('GNOME Weather Location')});
        const gnomeCheck = new Gtk.Image({icon_name: 'object-select-symbolic'});
        gnomeRow.add_suffix(gnomeCheck);
        locationGroup.add(gnomeRow);

        const placeRow = new Adw.EntryRow({
            title: _('Place'),
            text: settings.get_string('place'),
            show_apply_button: true,
        });
        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: _('Use GNOME Weather Location'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        placeRow.add_suffix(clearButton);
        locationGroup.add(placeRow);

        const updateLocationRows = () => {
            const place = settings.get_string('place').trim();
            gnomeRow.subtitle = readGnomeLocation(gnomeSettings)?.name ?? _('Not set');
            gnomeCheck.visible = !place;
            clearButton.visible = !!place;
        };
        updateLocationRows();
        settings.connect('changed::place', updateLocationRows);
        gnomeSettings?.connect('changed::locations', updateLocationRows);

        placeRow.connect('changed', () => placeRow.remove_css_class('error'));
        placeRow.connect('apply', async () => {
            const place = placeRow.text.trim();
            if (!place) {
                settings.set_string('place', '');
                return;
            }

            // Check that FMI knows the place before saving it.
            placeRow.sensitive = false;
            try {
                await fetchForecast(session, {place});
                settings.set_string('place', place);
            } catch (e) {
                placeRow.add_css_class('error');
                window.add_toast(new Adw.Toast({
                    title: e instanceof PlaceNotFoundError
                        ? _('Place “%s” not found').replace('%s', place)
                        : _('Could not check the place. Check your internet connection.'),
                }));
            } finally {
                placeRow.sensitive = true;
            }
        });
        clearButton.connect('clicked', () => {
            placeRow.text = '';
            placeRow.remove_css_class('error');
            settings.set_string('place', '');
        });

        // Top bar
        const panelGroup = new Adw.PreferencesGroup({title: _('Top Bar')});
        page.add(panelGroup);

        const temperatureRow = new Adw.SwitchRow({title: _('Show Temperature')});
        settings.bind('show-temperature', temperatureRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(temperatureRow);

        const positionRow = new Adw.ComboRow({
            title: _('Position'),
            model: Gtk.StringList.new([_('Left'), _('Center'), _('Right')]),
            selected: Math.max(0, POSITIONS.indexOf(settings.get_string('panel-position'))),
        });
        positionRow.connect('notify::selected', () =>
            settings.set_string('panel-position', POSITIONS[positionRow.selected]));
        panelGroup.add(positionRow);

        page.add(new Adw.PreferencesGroup({
            description: _('Weather data: Finnish Meteorological Institute, CC BY 4.0'),
        }));

        window.connect('close-request', () => {
            session.abort();
            return false;
        });
    }
}
