#!/bin/bash
# Veil OS, by name and by look: what the system says it is, the boot splash,
# the boot menu, the login screen, the logo and the wallpapers.

source /tmp/veil/steps/lib.sh

B=/tmp/veil/branding

# ------------------------------------------------------------------ identity
#
# The version codename stays "noble". Veil's own name for the release goes in
# VERSION instead. A great many install scripts - Docker's, VS Code's, every
# `add-apt-repository` - read VERSION_CODENAME or `lsb_release -cs` and build a
# repository address from it; a codename Ubuntu does not know is how a
# derivative ends up unable to install half the software written for Ubuntu.
# That is the "best compatibility" this system is meant to have.
#
# The files are diverted rather than edited, so that an upgrade of base-files
# does not quietly turn the system back into Ubuntu.

divert /usr/lib/os-release
cat > /usr/lib/os-release <<EOF
PRETTY_NAME="${VEIL_OS_NAME} ${VEIL_OS_VERSION}"
NAME="${VEIL_OS_NAME}"
VERSION_ID="${VEIL_OS_VERSION}"
VERSION="${VEIL_OS_VERSION} (${VEIL_OS_CODENAME^})"
VERSION_CODENAME=${UBUNTU_SUITE}
ID=${VEIL_OS_ID}
ID_LIKE="ubuntu debian"
HOME_URL="${VEIL_OS_HOME}"
SUPPORT_URL="${VEIL_OS_SUPPORT}"
BUG_REPORT_URL="${VEIL_OS_SUPPORT}"
PRIVACY_POLICY_URL="${VEIL_OS_HOME}#privacy"
UBUNTU_CODENAME=${UBUNTU_SUITE}
LOGO=veil-os
EOF
ln -sf ../usr/lib/os-release /etc/os-release

divert /etc/lsb-release
cat > /etc/lsb-release <<EOF
DISTRIB_ID=Veil
DISTRIB_RELEASE=${VEIL_OS_VERSION}
DISTRIB_CODENAME=${UBUNTU_SUITE}
DISTRIB_DESCRIPTION="${VEIL_OS_NAME} ${VEIL_OS_VERSION}"
EOF

# python-apt finds a distribution's release data by DISTRIB_ID. Without a
# template named for Veil, `add-apt-repository` fails outright - "could not
# find a distribution template for Veil/noble" - which would break every PPA a
# user ever tries to add, and this build's own Mesa PPA two steps from now.
# Linux Mint and Zorin ship the same thing for the same reason. Veil's is
# Ubuntu's, because the archive underneath is Ubuntu's.
templates=/usr/share/python-apt/templates
if [ -f "$templates/Ubuntu.info" ]; then
    cp "$templates/Ubuntu.info" "$templates/Veil.info"
    [ -f "$templates/Ubuntu.mirrors" ] && cp "$templates/Ubuntu.mirrors" "$templates/Veil.mirrors"
    # The template's release list is filled in from distro-info's table for
    # the distribution of the same name, lower-cased; Veil's releases are
    # Ubuntu's.
    ln -sf ubuntu.csv /usr/share/distro-info/veil.csv
    [ -f /usr/share/distro-info/veil.csv ] || { echo "distro-info has no ubuntu.csv" >&2; exit 1; }
    # SourcesList is what add-apt-repository builds first, and it reads every
    # template; get_distro alone does not.
    python3 -c "
from aptsources.distro import get_distro
from aptsources.sourceslist import SourcesList
SourcesList()
d = get_distro()
print('    -> python-apt sees', d.id, d.codename)"
else
    echo "python-apt templates not found at $templates" >&2
    exit 1
fi

divert /etc/issue
echo "${VEIL_OS_NAME} ${VEIL_OS_VERSION} \\n \\l" > /etc/issue
echo "" >> /etc/issue
divert /etc/issue.net
echo "${VEIL_OS_NAME} ${VEIL_OS_VERSION}" > /etc/issue.net

divert /etc/legal
cat > /etc/legal <<EOF

${VEIL_OS_NAME} is free software, built on Ubuntu. Each program's licence is
in /usr/share/doc/*/copyright.

EOF

# ------------------------------------------------------------------- logos

say "logos"
cp -a "$B/icons/." /usr/share/icons/
mkdir -p /usr/share/pixmaps/veil
cp "$B"/logo/*.png /usr/share/pixmaps/veil/
cp "$B/logo/veil-os-logo.png" /usr/share/pixmaps/veil-os.png

# GNOME's About page draws LOGO, and a wordmark beside it when there is one:
# LOGO-text for a light background, LOGO-text-dark for a dark one.
for size in 256 512; do
    d="/usr/share/icons/hicolor/${size}x${size}/apps"
    mkdir -p "$d"
done
cp "$B/logo/veil-word-dark.png"  /usr/share/icons/hicolor/512x512/apps/veil-os-text.png
cp "$B/logo/veil-word-light.png" /usr/share/icons/hicolor/512x512/apps/veil-os-text-dark.png
gtk-update-icon-cache -q -f /usr/share/icons/hicolor

# -------------------------------------------------------------- boot splash

say "boot splash"
theme=/usr/share/plymouth/themes/veil
rm -rf "$theme"
mkdir -p "$theme"
cp -a "$B/plymouth-theme/veil/." "$theme/"
cp -a "$B/plymouth/veil/." "$theme/"
update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth \
    "$theme/veil.plymouth" 200
update-alternatives --set default.plymouth "$theme/veil.plymouth"

# Ubuntu's own splash themes read this image as a watermark. Should one of them
# ever be the one that loads - a fallback, a changed alternative - it shows
# Veil rather than Ubuntu.
if [ -e /usr/share/plymouth/ubuntu-logo.png ]; then
    divert /usr/share/plymouth/ubuntu-logo.png
fi
cp "$B/logo/veil-word-light.png" /usr/share/plymouth/ubuntu-logo.png

# The text-mode splash, for machines with no framebuffer. It uses the
# ubuntu-text plugin, which plymouth-theme-ubuntu-text provides.
mkdir -p /usr/share/plymouth/themes/veil-text
cat > /usr/share/plymouth/themes/veil-text/veil-text.plymouth <<EOF
[Plymouth Theme]
Name=Veil Text
Description=Text mode splash for ${VEIL_OS_NAME}
ModuleName=ubuntu-text

[ubuntu-text]
title=${VEIL_OS_NAME} ${VEIL_OS_VERSION}
black=0x0b0e13
white=0xe6ebf2
brown=0x7dd3a0
blue=0x131b26
EOF
update-alternatives --install /usr/share/plymouth/themes/text.plymouth text.plymouth \
    /usr/share/plymouth/themes/veil-text/veil-text.plymouth 200
update-alternatives --set text.plymouth /usr/share/plymouth/themes/veil-text/veil-text.plymouth

# -------------------------------------------------------------- boot menu
#
# In /boot rather than /usr/share, so it still loads when the root file
# system is encrypted and /boot is the only thing GRUB can read.

say "boot menu"
gtheme=/boot/grub/themes/veil
mkdir -p "$gtheme"
cp /tmp/veil/branding/grub-theme/veil/theme.txt "$gtheme/"
cp "$B"/grub/veil/*.png "$gtheme/"
fonts=/usr/share/fonts/truetype/dejavu
grub-mkfont -s 12 -o "$gtheme/dejavu_sans_12.pf2" "$fonts/DejaVuSans.ttf"
grub-mkfont -s 16 -o "$gtheme/dejavu_sans_16.pf2" "$fonts/DejaVuSans.ttf"
grub-mkfont -s 16 -o "$gtheme/dejavu_sans_bold_16.pf2" "$fonts/DejaVuSans-Bold.ttf"
# The live image copies the theme from here.
mkdir -p /usr/share/grub/themes
rm -rf /usr/share/grub/themes/veil
cp -a "$gtheme" /usr/share/grub/themes/veil

mkdir -p /etc/default/grub.d
cat > /etc/default/grub.d/60-veil.cfg <<EOF
# Veil OS: its name in the boot menu, and its theme.
GRUB_DISTRIBUTOR="${VEIL_OS_NAME}"
GRUB_THEME="/boot/grub/themes/veil/theme.txt"
GRUB_GFXMODE=auto
GRUB_GFXPAYLOAD_LINUX=keep
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
EOF

# ------------------------------------------------------------ login screen

say "login screen"
mkdir -p /etc/dconf/profile /etc/dconf/db/gdm.d
cat > /etc/dconf/profile/gdm <<'EOF'
user-db:user
system-db:gdm
file-db:/usr/share/gdm/greeter-dconf-defaults
EOF
cat > /etc/dconf/db/gdm.d/01-veil <<'EOF'
[org/gnome/login-screen]
logo='/usr/share/pixmaps/veil/gdm-logo.png'
banner-message-enable=false

[org/gnome/desktop/interface]
color-scheme='prefer-dark'
cursor-theme='Bibata-Modern-Ice'
icon-theme='Papirus-Dark'
font-name='Inter 11'
EOF

# -------------------------------------------------------------- wallpapers

say "wallpapers"
mkdir -p /usr/share/backgrounds/veil /usr/share/gnome-background-properties
cp "$B"/wallpapers/*.png /usr/share/backgrounds/veil/
mkdir -p /usr/share/backgrounds/veil/thumbs
cp "$B"/wallpapers/thumbs/*.png /usr/share/backgrounds/veil/thumbs/

{
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE wallpapers SYSTEM "gnome-wp-list.dtd">'
    echo '<wallpapers>'
    for pair in \
        "veil-aurora:Aurora:veil-aurora" \
        "veil-night:Night:veil-dawn" \
        "veil-tide:Tide:veil-tide" \
        "veil-mark:Veil:veil-mark-light"; do
        IFS=: read -r dark name light <<<"$pair"
        cat <<EOF
  <wallpaper deleted="false">
    <name>Veil ${name}</name>
    <filename>/usr/share/backgrounds/veil/${light}.png</filename>
    <filename-dark>/usr/share/backgrounds/veil/${dark}.png</filename-dark>
    <options>zoom</options>
    <shade_type>solid</shade_type>
    <pcolor>#0b0e13</pcolor>
    <scolor>#0b0e13</scolor>
  </wallpaper>
EOF
    done
    echo '</wallpapers>'
} > /usr/share/gnome-background-properties/veil.xml

# --------------------------------------------------------------- installer

say "installer"
mkdir -p /etc/calamares/modules /etc/calamares/branding
cp /tmp/veil/installer/calamares/settings.conf /etc/calamares/
cp /tmp/veil/installer/calamares/modules/*.conf /etc/calamares/modules/
rm -rf /etc/calamares/branding/veil
cp -a /tmp/veil/installer/calamares/branding/veil /etc/calamares/branding/veil
cp "$B"/calamares/veil/*.png /etc/calamares/branding/veil/
sed -i "s/@VERSION@/${VEIL_OS_VERSION}/g" /etc/calamares/branding/veil/branding.desc
