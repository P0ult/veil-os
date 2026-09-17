#!/bin/bash
# The applications that come installed: LibreOffice, VLC, Veil Browser and
# Veil's own apps, and Flathub for everything the Veil Store offers.

source /tmp/veil/steps/lib.sh

install_list apps.list

# Flathub, system-wide, so the Store can install for every user without each
# one adding it.
say "Flathub"
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

# Veil Browser and Veil's own apps, from the .debs staged for this build.
# apt rather than dpkg, so their dependencies are resolved.
say "Veil packages"
ls -1 /tmp/veil/debs/
"${APT[@]}" install /tmp/veil/debs/*.deb

# Veil Browser is the default browser. Its executable's path is read from the
# desktop file the package installed, rather than assumed: electron-builder
# decides it, and a wrong guess here would register an alternative that
# points at nothing.
browser_desktop="$(grep -l '^Exec=.*[Vv]eil' /usr/share/applications/*.desktop 2>/dev/null \
    | grep -i 'veil-browser\|/veil\.desktop' || true)"
browser_desktop="${browser_desktop%%$'\n'*}"
if [ -n "$browser_desktop" ]; then
    # grep -m1 first, not `| head`: a desktop file can carry several Exec lines
    # (one per action), and head closing the pipe early is a pipefail failure.
    browser_bin="$(grep -m1 '^Exec=' "$browser_desktop" | sed 's/^Exec=//; s/"//g; s/ .*//')"
    if [ -n "$browser_bin" ] && [ -x "$browser_bin" ]; then
        say "default browser: $browser_bin ($(basename "$browser_desktop"))"
        update-alternatives --install /usr/bin/x-www-browser x-www-browser "$browser_bin" 200
        update-alternatives --install /usr/bin/gnome-www-browser gnome-www-browser "$browser_bin" 200
        # Kept, because the desktop defaults and the boot test both need to know it.
        mkdir -p /usr/lib/veil
        basename "$browser_desktop" > /usr/lib/veil/browser-desktop-id

        # Ubuntu 24.04 lets an Electron app use its sandbox only with an
        # AppArmor profile naming it. The package installs one when its
        # install script decides AppArmor is on, which inside this chroot
        # depends on the build machine - so make sure here, rather than find
        # out at first boot that the browser will not start.
        real_bin="$(readlink -f "$browser_bin")"
        profile="$(grep -rlsF "$real_bin" /etc/apparmor.d/ || true)"
        profile="${profile%%$'\n'*}"
        if [ -z "$profile" ]; then
            profile=/etc/apparmor.d/veil-browser
            bundled="$(dirname "$real_bin")/resources/apparmor-profile"
            if [ -f "$bundled" ]; then
                cp "$bundled" "$profile"
            else
                printf '%s\n' \
                    'abi <abi/4.0>,' \
                    'include <tunables/global>' \
                    '' \
                    "profile veil-browser \"$real_bin\" flags=(unconfined) {" \
                    '  userns,' \
                    '' \
                    '  include if exists <local/veil-browser>' \
                    '}' > "$profile"
            fi
            say "AppArmor profile added for $real_bin"
        fi
        apparmor_parser --skip-kernel-load --skip-cache "$profile" >/dev/null \
            || { echo "The browser's AppArmor profile ($profile) does not parse" >&2; exit 1; }
    else
        echo "Veil Browser's desktop file names '$browser_bin', which is not an executable" >&2
        exit 1
    fi
else
    echo "Veil Browser installed no desktop file" >&2
    exit 1
fi
