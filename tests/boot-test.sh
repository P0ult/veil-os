#!/bin/bash
# Boot a Veil OS ISO in QEMU and record what happens.
#
#     tests/boot-test.sh out/veil-os-1.0-amd64.iso out/boot-test
#
# Two machines, each with an empty 40 GB disk for the installer to see:
#
#   uefi  UEFI with Secure Boot enforced and Microsoft's keys enrolled, as on
#         a typical PC.
#   bios  Legacy BIOS, on an older PC chipset. GRUB and the kernel write
#         to the serial port too (see build/iso/grub.cfg), so a machine that
#         stops early still leaves a reason.
#
# Both carry the systemd credential veil.test as an SMBIOS OEM string, which
# makes the live system report on the serial port how far it got and what
# works (system/usr/lib/veil/veil-boot-report). Nothing is typed into the boot
# menu: each machine boots the way a person's would.
#
# Writes screenshots, serial logs and summary.md into the output directory,
# and exits non-zero if the desktop did not come up or a check failed.
# Needs qemu-system-x86, qemu-utils, ovmf and python3-pil; uses KVM when present.

set -uo pipefail   # not -e: a machine that fails to boot is a result to record

ISO="$(readlink -f "${1:?usage: boot-test.sh ISO [OUTDIR]}")"
OUT="${2:-out/boot-test}"
mkdir -p "$OUT" && [ -w "$OUT" ] || { echo "Cannot write to $OUT" >&2; exit 2; }
OUT="$(readlink -f "$OUT")"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QMP="$HERE/qmp.py"

OVMF_CODE=/usr/share/OVMF/OVMF_CODE_4M.secboot.fd
OVMF_VARS=/usr/share/OVMF/OVMF_VARS_4M.ms.fd

if [ -w /dev/kvm ]; then
    ACCEL=(-accel kvm -cpu host)
    SLOW=1
else
    echo "No KVM: this will be slow, and the timeouts are stretched to match."
    ACCEL=(-accel tcg -cpu max)
    SLOW=4
fi

log() { printf '\n== %s\n' "$*"; }
q() { python3 "$QMP" "$SOCK" "$@" >/dev/null 2>&1; }
alive() { kill -0 "$PID" 2>/dev/null; }

# The optical drive: AHCI on the modern machine, IDE on the older one.
CD_AHCI=(-device ahci,id=ahci0 -device ide-cd,drive=cd0,bus=ahci0.0,bootindex=0)
CD_IDE=(-device ide-cd,drive=cd0,bus=ide.1,bootindex=0)

start_machine() {   # dir, name of a cd device array, then extra qemu arguments
    local dir="$1"; shift
    local -n cd="$1"; shift
    mkdir -p "$dir"
    SOCK="$dir/qmp.sock"
    rm -f "$SOCK"
    qemu-img create -q -f qcow2 "$dir/disk.qcow2" 40G
    qemu-system-x86_64 "${ACCEL[@]}" \
        -m 6144 -smp 4 \
        -device virtio-vga -display none \
        -device virtio-net-pci,netdev=n0 -netdev user,id=n0 \
        -device qemu-xhci -device usb-tablet \
        -drive "file=$dir/disk.qcow2,if=none,id=disk0,format=qcow2" \
        -device virtio-blk-pci,drive=disk0,bootindex=1 \
        -drive "file=$ISO,media=cdrom,if=none,id=cd0,readonly=on" \
        "${cd[@]}" \
        -smbios type=11,value=io.systemd.credential:veil.test=1 \
        -serial "file:$dir/serial.log" \
        -qmp "unix:$SOCK,server=on,wait=off" \
        -no-reboot \
        "$@" > "$dir/qemu.log" 2>&1 &
    PID=$!
    for _ in $(seq 1 50); do [ -S "$SOCK" ] && return 0; sleep 0.2; done
    echo "QEMU did not start:"; cat "$dir/qemu.log"
    return 1
}

stop_machine() {
    q --quit
    for _ in $(seq 1 20); do alive || break; sleep 0.5; done
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
    rm -f "$1/disk.qcow2" "$1/vars.fd"
}

shot() { q "$1" && echo "  screenshot $(basename "$1")"; }

# The menu, the boot animation, then pictures until the serial log says
# `done` or time runs out: every 20 seconds until the desktop is up, every 4
# after that, so the apps the report opens are caught on screen.
record() {
    local dir="$1" limit=$(( $2 * SLOW )) n=0 next=0 every=20
    sleep $((5 * SLOW));  shot "$dir/grub-menu.png"
    sleep $((12 * SLOW)); shot "$dir/splash-1.png"
    sleep $((6 * SLOW));  shot "$dir/splash-2.png"

    local start=$SECONDS
    while alive && [ $((SECONDS - start)) -lt "$limit" ]; do
        if grep -aq 'VEIL-REPORT done' "$dir/serial.log" 2>/dev/null; then
            break
        fi
        if grep -aq 'VEIL-REPORT stage=desktop' "$dir/serial.log" 2>/dev/null; then
            every=4
        fi
        if [ $((SECONDS - start)) -ge "$next" ]; then
            shot "$dir/boot-$(printf '%03d' "$n").png"
            n=$((n + 1))
            next=$(( SECONDS - start + every ))
        fi
        sleep 1
    done
    sleep 3
    shot "$dir/final.png"
}

uefi() {
    local dir="$OUT/uefi"
    log "UEFI with Secure Boot"
    if [ ! -f "$OVMF_CODE" ] || [ ! -f "$OVMF_VARS" ]; then
        echo "OVMF with Secure Boot is not installed (package ovmf)"
        return 1
    fi
    mkdir -p "$dir"
    cp "$OVMF_VARS" "$dir/vars.fd"
    start_machine "$dir" CD_AHCI \
        -machine q35,smm=on \
        -global driver=cfi.pflash01,property=secure,value=on \
        -drive "if=pflash,format=raw,unit=0,file=$OVMF_CODE,readonly=on" \
        -drive "if=pflash,format=raw,unit=1,file=$dir/vars.fd" \
        || return 1
    record "$dir" 1200
    stop_machine "$dir"
}

bios() {
    local dir="$OUT/bios"
    log "Legacy BIOS"
    # An i440FX PC with an IDE drive: the kind of machine that still boots
    # this way.
    start_machine "$dir" CD_IDE -machine pc || return 1
    record "$dir" 1200
    stop_machine "$dir"
}

# ---------------------------------------------------------------- results

# One machine's findings; prints problems and returns non-zero if there are any.
judge() {
    local name="$1" report="$OUT/$1/serial.log" failed=0
    echo
    echo "## $name"
    echo
    echo '```'
    grep -a 'VEIL-REPORT' "$report" 2>/dev/null | sed 's/^.*VEIL-REPORT //' | tr -d '\r'
    echo '```'
    if ! grep -aq 'VEIL-REPORT stage=desktop' "$report" 2>/dev/null; then
        echo "- The desktop did not come up (see $name/serial.log and the screenshots)."
        failed=1
    fi
    if ! grep -aq 'VEIL-REPORT done' "$report" 2>/dev/null; then
        echo "- The report did not finish."
        failed=1
    fi
    if [ "$name" = uefi ] && ! grep -aq 'VEIL-REPORT secureboot=SecureBoot enabled' "$report" 2>/dev/null; then
        echo "- Secure Boot was not reported as enabled."
        failed=1
    fi
    if grep -aq 'VEIL-REPORT check .*=FAIL' "$report" 2>/dev/null; then
        echo "- Failed checks: $(grep -a 'VEIL-REPORT check .*=FAIL' "$report" | sed 's/^.*VEIL-REPORT check //; s/=FAIL.*//' | tr -d '\r' | tr '\n' ' ')"
        failed=1
    fi
    if grep -a 'VEIL-REPORT extension ' "$report" | grep -aqv 'state=1'; then
        echo "- Extensions not running: $(grep -a 'VEIL-REPORT extension ' "$report" | grep -av 'state=1' | sed 's/^.*VEIL-REPORT extension //' | tr -d '\r' | tr '\n' ' ')"
        failed=1
    fi
    return "$failed"
}

uefi
bios

{
    echo "# Veil OS boot test"
    echo
    echo "ISO: \`$(basename "$ISO")\` ($(du -h "$ISO" | cut -f1))"
} > "$OUT/summary.md"
failed=0
judge uefi >> "$OUT/summary.md" || failed=1
judge bios >> "$OUT/summary.md" || failed=1
[ "$failed" -eq 0 ] && echo "Everything checked passed." >> "$OUT/summary.md"
cat "$OUT/summary.md"
exit "$failed"
