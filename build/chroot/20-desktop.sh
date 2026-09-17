#!/bin/bash
# GNOME, and everything that makes it look like Veil: the extensions that
# give it a taskbar and a start menu, the GTK theme in every accent colour,
# the icons and the cursors.

source /tmp/veil/steps/lib.sh

install_list desktop.list

# --------------------------------------------------------------- extensions
#
# Installed system-wide, so every user has them and Veil Appearance can
# switch layouts without downloading anything. Their schemas are copied into
# the system schema directory too: that is what lets the defaults in
# /etc/dconf apply, and what lets `gsettings` set their keys by name.

for uuid in "${GNOME_EXTENSIONS[@]}"; do
    say "extension ${uuid}"
    info="$(fetch "https://extensions.gnome.org/extension-info/?uuid=${uuid}&shell_version=${GNOME_SHELL_VERSION}")"
    path="$(jq -r '.download_url // empty' <<<"$info")"
    [ -n "$path" ] || { echo "extensions.gnome.org has no ${uuid} for GNOME ${GNOME_SHELL_VERSION}" >&2; exit 1; }

    fetch -o /tmp/extension.zip "https://extensions.gnome.org${path}"
    dest="/usr/share/gnome-shell/extensions/${uuid}"
    rm -rf "$dest"
    mkdir -p "$dest"
    unzip -q -o /tmp/extension.zip -d "$dest"
    rm -f /tmp/extension.zip

    if compgen -G "$dest/schemas/*.gschema.xml" > /dev/null; then
        cp "$dest"/schemas/*.gschema.xml /usr/share/glib-2.0/schemas/
        # An extension with a schemas directory reads its settings from the
        # compiled file in it, and refuses to start without one. Packages
        # from extensions.gnome.org no longer carry it: GNOME compiles it
        # when installing through its own tools, which this is not.
        glib-compile-schemas --strict "$dest/schemas"
        [ -f "$dest/schemas/gschemas.compiled" ] || { echo "${uuid}: schemas did not compile" >&2; exit 1; }
    fi
    chmod -R a+rX "$dest"
    jq -r '"      version \(.version), for shell \(.["shell-version"] | join(", "))"' "$dest/metadata.json" || true
done

glib-compile-schemas /usr/share/glib-2.0/schemas

# -------------------------------------------------------------------- theme
#
# Colloid, in every accent colour and both light and dark, so that choosing a
# colour in Veil Appearance is picking an installed theme rather than
# rebuilding one.

tag="$(github_latest_tag "$COLLOID_GTK_REPO")"
say "Colloid GTK theme ${tag}"
fetch -o /tmp/colloid.tar.gz "https://github.com/${COLLOID_GTK_REPO}/archive/refs/tags/${tag}.tar.gz"
mkdir -p /tmp/colloid
tar -xzf /tmp/colloid.tar.gz -C /tmp/colloid --strip-components=1
(
    cd /tmp/colloid
    ./install.sh --dest /usr/share/themes --theme all --size standard
    # A rimless, floating-panel variant for the macOS-like layout.
    ./install.sh --dest /usr/share/themes --theme all --color dark --size standard \
        --name Colloid-Float --tweaks rimless float
)
rm -rf /tmp/colloid /tmp/colloid.tar.gz
# A count rather than `ls | head`: under pipefail, head closing the pipe early
# kills ls with SIGPIPE and takes the whole build down with it.
say "$(find /usr/share/themes -mindepth 1 -maxdepth 1 -name 'Colloid*' | wc -l) Colloid themes installed"

# -------------------------------------------------------------------- icons
#
# Papirus, from the archive, with its folder-colour tool so the folders can
# follow the accent colour.

say "papirus-folders"
fetch -o /usr/local/bin/papirus-folders "$PAPIRUS_FOLDERS_URL"
chmod 755 /usr/local/bin/papirus-folders
papirus-folders -C green --theme Papirus-Dark || true
papirus-folders -C green --theme Papirus-Light || true
papirus-folders -C green --theme Papirus || true

# ------------------------------------------------------------------ cursors

for cursor in Bibata-Modern-Ice Bibata-Modern-Classic Bibata-Modern-Amber; do
    say "cursor ${cursor}"
    url="$(github_asset_url "$BIBATA_REPO" "^${cursor}\\.tar\\.xz$")"
    [ -n "$url" ] || { echo "no ${cursor} in the latest Bibata release" >&2; exit 1; }
    fetch -o /tmp/cursor.tar.xz "$url"
    tar -xJf /tmp/cursor.tar.xz -C /usr/share/icons
    rm -f /tmp/cursor.tar.xz
done

# The cursor every program falls back to when it does not ask GNOME.
update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme \
    /usr/share/icons/Bibata-Modern-Ice/index.theme 90
update-alternatives --set x-cursor-theme /usr/share/icons/Bibata-Modern-Ice/index.theme

for dir in /usr/share/icons/*/; do
    [ -f "${dir}index.theme" ] && gtk-update-icon-cache -q -f "$dir" || true
done
