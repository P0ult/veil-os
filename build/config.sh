#!/bin/bash
# Everything about a Veil OS build that is a choice rather than a procedure.
#
# Sourced by build.sh on the host and by every script inside the chroot, so a
# version, a name or a package set is changed in one place.

# ------------------------------------------------------------------ identity

VEIL_OS_NAME="Veil OS"
VEIL_OS_ID="veil"
VEIL_OS_VERSION="${VEIL_OS_VERSION:-1.0}"
VEIL_OS_CODENAME="dawn"
VEIL_OS_HOME="https://github.com/P0ult/veil-os"
VEIL_OS_SUPPORT="https://github.com/P0ult/veil-os/issues"

# The live session's user and machine name.
LIVE_USER="veil"
LIVE_HOSTNAME="veil"

# ---------------------------------------------------------------------- base

# Ubuntu 24.04 LTS - the base Zorin OS 18 is built on, and the one every
# third-party repository this needs (WineHQ, the kisak Mesa PPA, the GNOME
# extensions) is known to serve. Verified before the first build.
UBUNTU_SUITE="noble"
UBUNTU_VERSION="24.04"
UBUNTU_MIRROR="${UBUNTU_MIRROR:-http://archive.ubuntu.com/ubuntu}"
ARCH="amd64"

# The hardware-enablement kernel: newer drivers, which matters most for the
# recent GPUs and wireless chips a gaming machine is likely to have.
KERNEL_PACKAGE="linux-generic-hwe-24.04"

# GNOME Shell on noble is 46; extensions are fetched for this version.
GNOME_SHELL_VERSION="46"

# ---------------------------------------------------------- where things come

# The browser. A published release is required - GitHub does not serve the
# assets of a draft to anyone without a token.
VEIL_BROWSER_REPO="P0ult/veil-browser"
VEIL_BROWSER_DEB_URL="${VEIL_BROWSER_DEB_URL:-}"   # set to skip the lookup

WINEHQ_BRANCH="stable"                             # stable | devel | staging
KISAK_PPA="ppa:kisak/kisak-mesa"

# GNOME Shell extensions, by UUID, from extensions.gnome.org. Dash to Panel,
# ArcMenu and Blur my Shell are not packaged for noble, so they are fetched.
# User Themes is not in this list: gnome-shell-extensions ships it, and
# unpacking a second copy over a file dpkg owns would be undone by the next
# upgrade of that package.
GNOME_EXTENSIONS=(
    "dash-to-panel@jderose9.github.com"
    "arcmenu@arcmenu.com"
    "blur-my-shell@aunetx"
)

# GTK theme and cursors, fetched from their own releases.
COLLOID_GTK_REPO="vinceliuice/Colloid-gtk-theme"
BIBATA_REPO="ful1e5/Bibata_Cursor"
PAPIRUS_FOLDERS_URL="https://raw.githubusercontent.com/PapirusDevelopmentTeam/papirus-folders/master/papirus-folders"
WINETRICKS_URL="https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks"

# ----------------------------------------------------------------- the image

ISO_LABEL="VEIL_OS"
ISO_NAME="veil-os-${VEIL_OS_VERSION}-${ARCH}.iso"

# xz at the largest block the kernel handles well: slower to build, and about
# a fifth smaller than gzip, which matters for an image this size.
SQUASHFS_COMP=(-comp xz -b 1M -Xdict-size 100%)
