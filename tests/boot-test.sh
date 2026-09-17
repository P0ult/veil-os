#!/bin/bash
# Boot a Veil OS ISO in QEMU and record what happens.
#
#     tests/boot-test.sh out/veil-os-1.0-amd64.iso out/boot-test
#
# Two machines:
#
#   uefi  UEFI with Secure Boot enforced and Microsoft's keys enrolled, as on
#         a typical PC. The GRUB menu is photographed, then the first entry is
#         edited to add veil.test=1, which makes the live system report on
#         the serial port how far it got and what works (veil-boot-report).
#   bios  Legacy BIOS. Photographed at the menu, during the boot animation and
#         at the desktop.
#
# Writes screenshots, serial logs and summary.md into the output directory,
# and exits non-zero if the desktop did not come up or a check failed.
# Needs qemu-system-x86, ovmf, xorriso and python3-pil; uses KVM when present.

set -uo pipefail   # not -e: a machine that fails to boot is a result to record

ISO="$(readlink -f "${1:?usage: boot-test.sh ISO [OUTDIR]}")"
OUT="$(mkdir -p "${2:-out/boot-test}" && readlink -f "${2:-out/boot-test}")"
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

start_machine() {   # dir, then extra qemu arguments
    local dir="$1"; shift
    mkdir -p "$dir"
    SOCK="$dir/qmp.sock"
    rm -f "$SOCK"
    qemu-system-x86_64 "${ACCEL[@]}" \
        -m 6144 -smp 4 \
        -device virtio-vga -display none \
        -device virtio-net-pci,netdev=n0 -netdev user,id=n0 \
        -device qemu-xhci -device usb-tablet \
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
}

shot() { q "$1" && echo "  screenshot $(basename "$1")"; }

# Photograph and wait until the serial log says `done`, or time runs out.
# Every 20 seconds until the desktop is up, then every 5.
watch_report() {
    local dir="$1" limit=$(( $2 * SLOW )) n=0 next=0 every=20
    local start=$SECONDS
    while alive && [ $((SECONDS - start)) -lt "$limit" ]; do
        if grep -q 'VEIL-REPORT done' "$dir/serial.log" 2>/dev/null; then
            break
        fi
        if grep -q 'VEIL-REPORT stage=desktop' "$dir/serial.log" 2>/dev/null; then
            every=5
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

# ------------------------------------------------------------------- UEFI

uefi() {
    local dir="$OUT/uefi"
    log "UEFI with Secure Boot"
    if [ ! -f "$OVMF_CODE" ] || [ ! -f "$OVMF_VARS" ]; then
        echo "OVMF with Secure Boot is not installed (package ovmf)"
        return 1
    fi
    mkdir -p "$dir"
    cp "$OVMF_VARS" "$dir/vars.fd"
    start_machine "$dir" \
        -machine q35,smm=on \
        -global driver=cfi.pflash01,property=secure,value=on \
        -drive "if=pflash,format=raw,unit=0,file=$OVMF_CODE,readonly=on" \
        -drive "if=pflash,format=raw,unit=1,file=$dir/vars.fd" \
        -drive "file=$ISO,media=cdrom,if=none,id=cd0,readonly=on" \
        -device ahci,id=ahci0 -device ide-cd,drive=cd0,bus=ahci0.0,bootindex=0 \
        || return 1

    # Any key stops GRUB's countdown; "up" on the first entry leaves it
    # selected. Pressed from the start, so it lands whenever the menu shows.
    local t
    for t in $(seq 1 $((24 * SLOW))); do
        q --key up
        [ "$t" -eq $((8 * SLOW)) ] && shot "$dir/grub-menu-early.png"
        sleep 0.5
    done
    shot "$dir/grub-menu.png"

    # Edit the first entry: its second line is the kernel's.
    q --key e;            sleep 1
    q --key down;         sleep 0.3
    q --key end;          sleep 0.3
    q --type " veil.test=1 console=tty0 console=ttyS0,115200"
    sleep 0.5
    shot "$dir/grub-edit.png"
    q --key ctrl x

    sleep $((6 * SLOW))
    shot "$dir/splash-1.png"
    sleep $((6 * SLOW))
    shot "$dir/splash-2.png"

    watch_report "$dir" 1500
    stop_machine
}

# ------------------------------------------------------------------- BIOS

bios() {
    local dir="$OUT/bios"
    log "Legacy BIOS"
    start_machine "$dir" \
        -machine q35 \
        -drive "file=$ISO,media=cdrom,if=none,id=cd0,readonly=on" \
        -device ahci,id=ahci0 -device ide-cd,drive=cd0,bus=ahci0.0,bootindex=0 \
        || return 1
    sleep $((6 * SLOW))
    shot "$dir/grub-menu.png"
    # Let the countdown run out: the default entry is what most people boot.
    sleep $((14 * SLOW))
    shot "$dir/splash.png"
    local i
    for i in $(seq 1 12); do
        sleep $((20 * SLOW))
        alive || break
        shot "$dir/boot-$(printf '%02d' "$i").png"
    done
    stop_machine
}

# ---------------------------------------------------------------- results

summarise() {
    local report="$OUT/uefi/serial.log" summary="$OUT/summary.md" failed=0
    {
        echo "# Veil OS boot test"
        echo
        echo "ISO: \`$(basename "$ISO")\` ($(du -h "$ISO" | cut -f1))"
        echo
        echo '```'
        grep -a 'VEIL-REPORT' "$report" 2>/dev/null | sed 's/^.*VEIL-REPORT //' | tr -d '\r'
        echo '```'
    } > "$summary"

    if ! grep -aq 'VEIL-REPORT stage=desktop' "$report" 2>/dev/null; then
        echo "The desktop did not come up (see uefi/serial.log and the screenshots)." | tee -a "$summary"
        failed=1
    fi
    if ! grep -aq 'VEIL-REPORT done' "$report" 2>/dev/null; then
        echo "The report did not finish." | tee -a "$summary"
        failed=1
    fi
    if ! grep -aq 'VEIL-REPORT secureboot=SecureBoot enabled' "$report" 2>/dev/null; then
        echo "Secure Boot was not reported as enabled." | tee -a "$summary"
        failed=1
    fi
    if grep -a 'VEIL-REPORT check .*=FAIL' "$report" >/dev/null 2>&1; then
        echo "Failed checks:" | tee -a "$summary"
        grep -a 'VEIL-REPORT check .*=FAIL' "$report" | sed 's/^.*VEIL-REPORT /  /' | tee -a "$summary"
        failed=1
    fi
    if grep -a 'VEIL-REPORT extension ' "$report" | grep -av 'state=1' >/dev/null 2>&1; then
        echo "Extensions not running:" | tee -a "$summary"
        grep -a 'VEIL-REPORT extension ' "$report" | grep -av 'state=1' | sed 's/^.*VEIL-REPORT /  /' | tee -a "$summary"
        failed=1
    fi
    [ "$failed" -eq 0 ] && echo "Everything checked passed." | tee -a "$summary"
    return "$failed"
}

uefi
bios
summarise
