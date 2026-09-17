#!/bin/bash
# Build the veil-center .deb: the Veil Store and Veil Appearance.
#
#     apps/veil-center/build-deb.sh          # writes apps/dist/veil-center_<version>_amd64.deb
#
# Needs Node.js 20 or later, dpkg-deb and Python 3 with Pillow (for the icons).
# Runs on Linux only: electron-builder needs a Linux host for a Linux build.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DIST="$ROOT/apps/dist"
PKG="$HERE/build/pkg"

cd "$HERE"
VERSION="$(node -p "require('./package.json').version")"

echo "==> veil-center $VERSION"

# The layouts are defined once, for the desktop build; the app carries a copy.
cp "$ROOT/desktop/layouts.json" data/layouts.json

if [ ! -f "$ROOT/branding/out/icons/hicolor/256x256/apps/veil-store.png" ]; then
    python3 "$ROOT/branding/generate.py"
fi

if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
else
    npm install --no-audit --no-fund
fi
npm test
npx electron-builder --linux dir --x64 --publish never

rm -rf "$PKG"
mkdir -p "$PKG/DEBIAN" "$PKG/opt" "$PKG/usr/bin" "$PKG/usr/lib/veil" \
         "$PKG/usr/share/applications" "$PKG/usr/share/polkit-1/actions" \
         "$PKG/etc/apparmor.d"

cp -a dist/linux-unpacked "$PKG/opt/veil-center"

for mode in store appearance; do
    cat > "$PKG/usr/bin/veil-$mode" <<EOF
#!/bin/sh
exec /opt/veil-center/veil-center --$mode "\$@"
EOF
    chmod 0755 "$PKG/usr/bin/veil-$mode"
done

install -m 0644 packaging/veil-store.desktop packaging/veil-appearance.desktop "$PKG/usr/share/applications/"
install -m 0755 helper/veil-store-helper "$PKG/usr/lib/veil/veil-store-helper"
install -m 0644 helper/os.veil.store.policy "$PKG/usr/share/polkit-1/actions/os.veil.store.policy"
install -m 0644 packaging/apparmor-veil-center "$PKG/etc/apparmor.d/veil-center"

for size in 16 22 24 32 48 64 96 128 256 512; do
    d="$PKG/usr/share/icons/hicolor/${size}x${size}/apps"
    mkdir -p "$d"
    for name in veil-store veil-appearance; do
        install -m 0644 "$ROOT/branding/out/icons/hicolor/${size}x${size}/apps/$name.png" "$d/"
    done
done

install -m 0755 packaging/postinst packaging/postrm "$PKG/DEBIAN/"
echo "/etc/apparmor.d/veil-center" > "$PKG/DEBIAN/conffiles"

size_kb="$(du -sk "$PKG" | cut -f1)"
cat > "$PKG/DEBIAN/control" <<EOF
Package: veil-center
Version: $VERSION
Section: admin
Priority: optional
Architecture: amd64
Installed-Size: $size_kb
Depends: flatpak, pkexec, libgtk-3-0t64, libnss3, libgbm1, libasound2t64, libxss1, xdg-utils, apparmor
Maintainer: Veil OS <https://github.com/P0ult/veil-os>
Homepage: https://github.com/P0ult/veil-os
Description: Veil Store and Veil Appearance
 The Veil Store installs apps from Flathub and Ubuntu, and suggests
 replacements for the Windows programs people already know. Veil Appearance
 arranges the desktop: layouts, colours, wallpaper, taskbar, text and pointer.
EOF

mkdir -p "$DIST"
dpkg-deb --build --root-owner-group -Zxz "$PKG" "$DIST/veil-center_${VERSION}_amd64.deb"
echo "==> $DIST/veil-center_${VERSION}_amd64.deb"
