#!/bin/bash
# Leave the system as it should be copied onto a disk: no build leftovers, no
# identity of the machine it was built on, and an initramfs that carries the
# Veil boot splash.

source /tmp/veil/steps/lib.sh

say "boot splash into the initramfs"
update-initramfs -u -k all

say "tidying packages"
"${APT[@]}" autoremove --purge
apt-get clean

say "removing build leftovers"
rm -f /usr/sbin/policy-rc.d

# Files copied from the build machine, and files unpacked from release
# archives, keep the owner they had there - often uid 1000, which on an
# installed system is the first person to sign in. Nothing in the image may
# belong to an account the image does not have.
say "ownership"
find / -xdev \( -nouser -o -nogroup \) -not -path '/tmp/*' -exec chown -h root:root {} +
stray="$(find / -xdev \( -nouser -o -nogroup \) -not -path '/tmp/*' | wc -l)"
[ "$stray" -eq 0 ] || { echo "$stray files still belong to no account" >&2; exit 1; }

# Every installed machine gets its own identity on first boot.
: > /etc/machine-id
rm -f /var/lib/dbus/machine-id
ln -sf /etc/machine-id /var/lib/dbus/machine-id

# noble resolves names through systemd-resolved; the build borrowed the host's
# resolv.conf and the link goes back now.
rm -f /etc/resolv.conf
ln -s ../run/systemd/resolve/stub-resolv.conf /etc/resolv.conf

# SSH host keys, if anything created them, are never shared between machines.
rm -f /etc/ssh/ssh_host_*

rm -rf /var/lib/apt/lists/* /var/cache/apt/*.bin
find /var/log -type f -exec truncate -s 0 {} + 2>/dev/null || true
rm -rf /root/.bash_history /root/.cache /root/.wget-hsts
rm -rf /var/tmp/*

# What the image contains, for the build log.
say "installed packages: $(dpkg-query -W | wc -l)"
say "size: $(du -sh --exclude=/proc --exclude=/sys --exclude=/dev --exclude=/run --exclude=/tmp / 2>/dev/null | cut -f1)"

# /tmp/veil is removed by build.sh once this step returns; it is excluded from
# the image either way.
