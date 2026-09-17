#!/bin/bash
# The kernel and the system underneath the desktop.

source /tmp/veil/steps/lib.sh

say "kernel: ${KERNEL_PACKAGE}"
"${APT[@]}" install "${KERNEL_PACKAGE}"

install_list base.list

say "locale"
sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
locale-gen en_US.UTF-8
update-locale LANG=en_US.UTF-8

# Swap in compressed memory, sized to half of RAM. It is what lets a 4 GB
# machine keep a browser open while a game loads.
cat > /etc/default/zramswap <<'EOF'
ALGO=zstd
PERCENT=50
PRIORITY=100
EOF

# The live user gets these names; the installer asks for real ones.
cat > /etc/casper.conf <<EOF
# Read by casper when the live image starts.
export USERNAME="${LIVE_USER}"
export USERFULLNAME="Live session user"
export HOST="${LIVE_HOSTNAME}"
export BUILD_SYSTEM="Ubuntu"
export FLAVOUR="Veil"
EOF

echo "${LIVE_HOSTNAME}" > /etc/hostname
cat > /etc/hosts <<EOF
127.0.0.1   localhost
127.0.1.1   ${LIVE_HOSTNAME}
::1         localhost ip6-localhost ip6-loopback
ff02::1     ip6-allnodes
ff02::2     ip6-allrouters
EOF

# NetworkManager manages everything, not just what is in /etc/network.
mkdir -p /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/10-veil-managed.conf <<'EOF'
[ifupdown]
managed=true
EOF
# netplan hands every device to NetworkManager.
mkdir -p /etc/netplan
cat > /etc/netplan/01-network-manager-all.yaml <<'EOF'
network:
  version: 2
  renderer: NetworkManager
EOF
chmod 600 /etc/netplan/01-network-manager-all.yaml
