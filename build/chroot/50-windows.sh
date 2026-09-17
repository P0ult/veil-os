#!/bin/bash
# Running Windows programs.
#
# Wine from WineHQ rather than from Ubuntu: noble's is 9.0 and will stay 9.0,
# while WineHQ's stable branch moves forward, and compatibility with any given
# program is almost entirely a matter of how recent Wine is. Winetricks from
# its own repository for the same reason. DXVK and VKD3D-Proton are added per
# user on first run by veil-run-windows, since they live inside the prefix.

source /tmp/veil/steps/lib.sh

install_list windows.list

say "WineHQ repository"
mkdir -pm755 /etc/apt/keyrings
fetch -o /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key
fetch -o "/etc/apt/sources.list.d/winehq-${UBUNTU_SUITE}.sources" \
    "https://dl.winehq.org/wine-builds/ubuntu/dists/${UBUNTU_SUITE}/winehq-${UBUNTU_SUITE}.sources"
"${APT[@]}" update

say "Wine (${WINEHQ_BRANCH})"
"${APT[@]}" install --install-recommends "winehq-${WINEHQ_BRANCH}"
/opt/wine-${WINEHQ_BRANCH}/bin/wine --version || wine --version

say "winetricks"
fetch -o /usr/local/bin/winetricks "$WINETRICKS_URL"
chmod 755 /usr/local/bin/winetricks
/usr/local/bin/winetricks --version

say "Windows program loader"
install -m 755 /tmp/veil/system/usr/bin/veil-run-windows /usr/bin/veil-run-windows
install -m 644 /tmp/veil/system/usr/share/applications/veil-run-windows.desktop /usr/share/applications/
install -m 644 /tmp/veil/system/usr/share/applications/veil-windows-settings.desktop /usr/share/applications/

# Wine installs its own launcher for .exe files. Veil's does the first-run
# setup that makes games work, so Wine's is kept out of the "Open with" list
# rather than competing with it.
for f in /usr/share/applications/wine.desktop /opt/wine-*/share/applications/wine.desktop; do
    [ -f "$f" ] && sed -i 's/^NoDisplay=.*//; $a NoDisplay=true' "$f" || true
done

update-desktop-database -q /usr/share/applications || true
