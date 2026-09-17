#!/bin/bash
# Games: newer Mesa, Steam, Lutris, GameMode, MangoHud, and the tools for
# NVIDIA drivers to be chosen on first boot.

source /tmp/veil/steps/lib.sh

# The kisak PPA tracks Mesa's stable releases, which is where support for new
# AMD and Intel GPUs - and most game fixes - arrives first.
say "Mesa from ${KISAK_PPA}"
for attempt in 1 2 3; do
    if add-apt-repository -y -n "$KISAK_PPA"; then break; fi
    [ "$attempt" = 3 ] && { echo "could not add ${KISAK_PPA}" >&2; exit 1; }
    sleep 10
done
"${APT[@]}" update
"${APT[@]}" full-upgrade

install_list gaming.list

# GameMode is allowed to change the CPU governor and nice level for games
# without asking for a password.
if [ -f /usr/share/polkit-1/actions/com.feralinteractive.GameMode.policy ]; then
    say "GameMode polkit rule present"
fi

# MangoHud's defaults: the few numbers people actually want, top-left, and
# off until Shift+F12.
mkdir -p /etc/skel/.config/MangoHud
cat > /etc/skel/.config/MangoHud/MangoHud.conf <<'EOF'
# Shift+F12 shows or hides this. Edit freely.
no_display
toggle_hud=Shift_R+F12
position=top-left
fps
frametime
gpu_stats
gpu_temp
cpu_stats
cpu_temp
ram
vram
background_alpha=0.4
font_size=20
EOF

# NVIDIA: the driver is chosen for the card that is actually present, on the
# first boot of the installed system. See system/usr/lib/veil/veil-firstboot.
"${APT[@]}" install ubuntu-drivers-common
