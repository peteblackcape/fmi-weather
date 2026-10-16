#!/usr/bin/env bash
# Usage: ./build.sh [build|pot|install|uninstall|pack|clean]
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")"

UUID=fmi-weather@peteblackcape.github.io
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SOURCES=(src/extension.js src/prefs.js src/fmi.js src/forecast.js src/location.js src/symbols.js)

build() {
    glib-compile-schemas --strict src/schemas
    for po in po/*.po; do
        lang=$(basename "$po" .po)
        mkdir -p "src/locale/$lang/LC_MESSAGES"
        msgfmt --check -o "src/locale/$lang/LC_MESSAGES/$UUID.mo" "$po"
    done
}

case "${1:-build}" in
build)
    build ;;
pot)
    xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --keyword=N_ \
        --add-comments=Translators --package-name=fmi-weather \
        -o po/fmi-weather.pot "${SOURCES[@]}"
    sed -i "s/charset=CHARSET/charset=UTF-8/" po/fmi-weather.pot
    for po in po/*.po; do msgmerge --update --backup=none "$po" po/fmi-weather.pot; done ;;
install)
    # Symlink the source tree so edits only need a re-login to take effect.
    build
    mkdir -p "$(dirname "$INSTALL_DIR")"
    ln -sfn "$PWD/src" "$INSTALL_DIR" ;;
uninstall)
    rm -f "$INSTALL_DIR" ;;
pack)
    # gnome-extensions crashes if the output directory does not exist.
    mkdir -p build
    build
    gnome-extensions pack --force --out-dir=build \
        --extra-source=fmi.js --extra-source=forecast.js \
        --extra-source=location.js --extra-source=symbols.js \
        --podir=../po src ;;
clean)
    rm -rf build src/locale src/schemas/gschemas.compiled ;;
*)
    echo "Usage: $0 [build|pot|install|uninstall|pack|clean]" >&2
    exit 1 ;;
esac
