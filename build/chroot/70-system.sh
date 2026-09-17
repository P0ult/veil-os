#!/bin/bash
# Veil's own system files: first-boot driver setup, its notifier, the live
# installer launcher, and the boot-test reporter.

source /tmp/veil/steps/lib.sh

S=/tmp/veil/system

say "first-boot driver setup"
install -d -m 755 /usr/lib/veil
install -m 755 "$S/usr/lib/veil/veil-firstboot"        /usr/lib/veil/
install -m 755 "$S/usr/lib/veil/veil-firstboot-notify" /usr/lib/veil/
install -m 644 "$S/etc/systemd/system/veil-firstboot.service" /etc/systemd/system/
# Not enabled here: the installer enables it in the system it installs, so the
# live image never tries to install a driver onto itself.

cat > /etc/xdg/autostart/veil-firstboot-notify.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Veil OS first-boot notices
Exec=/usr/lib/veil/veil-firstboot-notify
NoDisplay=true
X-GNOME-Autostart-Phase=Applications
X-GNOME-Autostart-Delay=8
OnlyShowIn=GNOME;
EOF

say "login session"
# The plain GNOME session for everyone. Veil's look lives in the system dconf
# database, which every GNOME session reads; Ubuntu's own session, if a
# dependency brought it in, would add Ubuntu's session mode on top.
# DefaultSession is an Ubuntu addition to GDM's configuration.
if ! grep -q '^DefaultSession=' /etc/gdm3/custom.conf 2>/dev/null; then
    sed -i 's/^\[daemon\]$/[daemon]\nDefaultSession=gnome.desktop/' /etc/gdm3/custom.conf
fi
grep -q '^DefaultSession=gnome.desktop' /etc/gdm3/custom.conf \
    || { echo "could not set GDM's default session" >&2; exit 1; }

say "boot-test reporter"
install -m 755 "$S/usr/lib/veil/veil-boot-report" /usr/lib/veil/
install -m 644 "$S/etc/systemd/system/veil-boot-report.service" /etc/systemd/system/
# Enabled always; it only runs when the kernel is started with veil.test=1.
systemctl enable veil-boot-report.service

say "installer launcher"
"${APT[@]}" install calamares calamares-settings-ubuntu-common
install -m 755 /tmp/veil/installer/bin/veil-installer /usr/bin/veil-installer
install -m 644 /tmp/veil/installer/applications/veil-installer.desktop /usr/share/applications/
# In the live session the installer offers itself at login. The installed
# system never sees this: the installer removes the file on its way out.
install -m 644 /tmp/veil/installer/applications/veil-installer.desktop /etc/xdg/autostart/veil-installer.desktop
sed -i 's/^X-GNOME-Autostart-enabled=.*/X-GNOME-Autostart-enabled=true/' /etc/xdg/autostart/veil-installer.desktop
# No X-GNOME-Autostart-Condition to keep it out of an installed system: GNOME
# resolves that condition's path under ~/.config, so it cannot point at a
# system file. The installer's last step deletes this file instead.
