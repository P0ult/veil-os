#!/bin/bash
# How a new user's desktop looks and behaves before they change anything.

source /tmp/veil/steps/lib.sh

browser="$(cat /usr/lib/veil/browser-desktop-id)"

# ------------------------------------------------------------------ dconf
#
# System defaults for every user, from desktop/dconf. Two values depend on
# this build - the browser's desktop file name - and are filled in here.

say "desktop defaults"
mkdir -p /etc/dconf/profile /etc/dconf/db/local.d
cat > /etc/dconf/profile/user <<'EOF'
user-db:user
system-db:local
EOF

favorites="['${browser}', 'org.gnome.Nautilus.desktop', 'veil-store.desktop', 'libreoffice-writer.desktop', 'vlc.desktop', 'steam.desktop', 'org.gnome.Terminal.desktop']"
pinned="[{'id': '${browser}'}, {'id': 'org.gnome.Nautilus.desktop'}, {'id': 'veil-store.desktop'}, {'id': 'veil-appearance.desktop'}, {'id': 'libreoffice-writer.desktop'}, {'id': 'vlc.desktop'}, {'id': 'steam.desktop'}, {'id': 'org.gnome.Settings.desktop'}]"

for f in /tmp/veil/desktop/dconf/*; do
    name="$(basename "$f")"
    sed -e "s|@FAVORITES@|${favorites}|" -e "s|@PINNED@|${pinned}|" "$f" > "/etc/dconf/db/local.d/${name}"
done

# Compiled once on its own first, because `dconf update` reports a syntax
# error and carries on, which would leave every setting at GNOME's default
# with nothing in the log to say why. `dconf compile` fails instead.
dconf compile /tmp/veil/dconf-check /etc/dconf/db/local.d
dconf compile /tmp/veil/dconf-check-gdm /etc/dconf/db/gdm.d
dconf update
[ -s /etc/dconf/db/local ] || { echo "dconf did not compile the defaults" >&2; exit 1; }
[ -s /etc/dconf/db/gdm ]   || { echo "dconf did not compile the login screen defaults" >&2; exit 1; }

# -------------------------------------------------------- GTK 4 applications
#
# libadwaita does not read the GTK theme setting; it reads ~/.config/gtk-4.0.
# Copying the theme there is what makes GNOME's own apps match everything else.
# Veil Appearance rewrites these files when the accent colour changes.

say "GTK 4 theme for new users"
src=/usr/share/themes/Colloid-Green-Dark/gtk-4.0
if [ -d "$src" ]; then
    mkdir -p /etc/skel/.config/gtk-4.0
    cp -aL "$src"/. /etc/skel/.config/gtk-4.0/
else
    echo "Colloid-Green-Dark has no gtk-4.0 directory" >&2
    exit 1
fi

# ------------------------------------------------------ Qt follows GTK

mkdir -p /etc/environment.d
cat > /etc/environment.d/60-veil-qt.conf <<'EOF'
# Qt programs - VLC, the installer - draw themselves with the GTK theme, so
# they look like the rest of the desktop.
QT_QPA_PLATFORMTHEME=gtk3
EOF

# ------------------------------------------------------- default programs

say "default programs"
cat > /etc/xdg/mimeapps.list <<EOF
[Default Applications]
text/html=${browser}
application/xhtml+xml=${browser}
x-scheme-handler/http=${browser}
x-scheme-handler/https=${browser}
x-scheme-handler/about=${browser}
application/x-ms-dos-executable=veil-run-windows.desktop
application/x-msdos-program=veil-run-windows.desktop
application/x-msdownload=veil-run-windows.desktop
application/vnd.microsoft.portable-executable=veil-run-windows.desktop
application/x-msi=veil-run-windows.desktop
application/x-ms-shortcut=veil-run-windows.desktop
application/pdf=org.gnome.Evince.desktop
video/mp4=vlc.desktop
video/x-matroska=vlc.desktop
video/webm=vlc.desktop
video/x-msvideo=vlc.desktop
video/quicktime=vlc.desktop
video/mpeg=vlc.desktop
audio/mpeg=vlc.desktop
audio/flac=vlc.desktop
audio/x-wav=vlc.desktop
audio/ogg=vlc.desktop
audio/mp4=vlc.desktop
application/vnd.openxmlformats-officedocument.wordprocessingml.document=libreoffice-writer.desktop
application/msword=libreoffice-writer.desktop
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet=libreoffice-calc.desktop
application/vnd.ms-excel=libreoffice-calc.desktop
application/vnd.openxmlformats-officedocument.presentationml.presentation=libreoffice-impress.desktop
application/vnd.ms-powerpoint=libreoffice-impress.desktop
EOF
cp /etc/xdg/mimeapps.list /usr/share/applications/gnome-mimeapps.list
update-desktop-database -q /usr/share/applications || true

# ------------------------------------------------------- user directories

# A Games folder beside Documents and Music: somewhere obvious for Lutris,
# Bottles and Wine prefixes to put things.
mkdir -p /etc/skel/Games
