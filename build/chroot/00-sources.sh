#!/bin/bash
# Where packages come from, and what the chroot must not do while it is built.

source /tmp/veil/steps/lib.sh

# Nothing installed in here should try to start a service: there is no init
# running, and a daemon started now would hold the chroot open.
cat > /usr/sbin/policy-rc.d <<'EOF'
#!/bin/sh
exit 101
EOF
chmod +x /usr/sbin/policy-rc.d

# Ubuntu, in the deb822 form noble uses, with every component: restricted for
# firmware and the NVIDIA driver, multiverse for Steam.
rm -f /etc/apt/sources.list
cat > /etc/apt/sources.list.d/ubuntu.sources <<EOF
Types: deb
URIs: ${UBUNTU_MIRROR}
Suites: ${UBUNTU_SUITE} ${UBUNTU_SUITE}-updates ${UBUNTU_SUITE}-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu
Suites: ${UBUNTU_SUITE}-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF

# No snapd. Apps come as .debs or from Flathub; a second store with its own
# background updater and its own loop devices is not something this system
# needs, and on a privacy-minded desktop it is something people ask to remove.
cat > /etc/apt/preferences.d/veil-no-snap.pref <<'EOF'
# Veil OS does not use snaps. Remove this file to allow snapd.
Package: snapd
Pin: release a=*
Pin-Priority: -10
EOF

# Documentation is most of a package's size and nobody reads it on a laptop.
# Copyright files stay: they are the licence terms, and they are required.
cat > /etc/dpkg/dpkg.cfg.d/veil-nodoc <<'EOF'
path-exclude=/usr/share/doc/*
path-include=/usr/share/doc/*/copyright
path-exclude=/usr/share/doc-base/*
EOF

# 32-bit libraries, for Wine and Steam.
dpkg --add-architecture i386

# Answers to the questions some packages ask while installing.
debconf-set-selections <<'EOF'
libc6 libraries/restart-without-asking boolean true
grub-pc grub-pc/install_devices multiselect
grub-pc grub-pc/install_devices_empty boolean true
steam-installer steam/question select I AGREE
steam-installer steam/license note
steam steam/question select I AGREE
steam steam/license note
EOF

say "updating"
"${APT[@]}" update
"${APT[@]}" full-upgrade
"${APT[@]}" install jq curl ca-certificates gnupg software-properties-common apt-utils
