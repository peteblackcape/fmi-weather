# FMI Weather

A small GNOME Shell extension that shows the weather from the
[Finnish Meteorological Institute](https://en.ilmatieteenlaitos.fi/) (Ilmatieteenlaitos)
in the top bar.

The extension follows the GNOME design guidelines. It uses the theme's own
symbolic weather icons and shows only the essentials:

- **Top bar:** current conditions and temperature
- **Menu:** current weather, the next 6 hours and the next 3 days, plus a link
  to the place's page on ilmatieteenlaitos.fi

## Location

By default the extension uses the location set in GNOME Weather. In the
extension settings you can set a more precise place, such as a smaller town
that GNOME Weather does not list. The custom place takes priority when it is
set.

## Requirements

- GNOME Shell 50 or 51 (for example Fedora 45 or Ubuntu 26.04)

## Installing from source

```sh
./build.sh install
```

This compiles the settings schema and translations, then symlinks `src/` into
`~/.local/share/gnome-shell/extensions/`. Log out and back in, then enable the
extension in the Extensions app or with:

```sh
gnome-extensions enable fmi-weather@peteblackcape.github.io
```

Other commands:

- `./build.sh pot` updates the translation template and merges it into `po/*.po`.
- `./build.sh pack` builds a zip in `build/` for extensions.gnome.org.

## Data

Weather data comes from the FMI open data service
(`fmi::forecast::edited::weather::scandinavia::point::simple`) and is licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The extension
fetches it every 15 minutes, and it keeps a cached copy in
`~/.cache/fmi-weather@peteblackcape.github.io/`.

## Privacy

To get the forecast, the extension sends the place name, or the coordinates of
the GNOME Weather location, to `opendata.fmi.fi` over HTTPS. Nothing else is
sent, and no other services are contacted.

## License

GPL-2.0-or-later
