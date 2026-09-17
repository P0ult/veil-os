#!/bin/bash
# Boot a Veil OS ISO in QEMU and record what happens.
#
#     tests/boot-test.sh out/veil-os-1.0-amd64.iso out/boot-test
#     VEIL_TESTS="install" tests/boot-test.sh ...     # only some machines
#
# Three machines, each with an empty 40 GB disk:
#
#   uefi     UEFI with Secure Boot enforced and Microsoft's keys enrolled, as
#            on a typical PC. The live session is checked.
#   bios     Legacy BIOS, on an older PC chipset. GRUB and the kernel write to
#            the serial port too (see build/iso/grub.cfg), so a machine that
#            stops early still leaves a reason.
#   install  The UEFI machine again, through the installer: the harness
#            clicks through it, the machine restarts into the installed
#            system, the harness signs in, and that system is checked.
#
# Each carries the systemd credential veil.test as an SMBIOS OEM string,
# which makes the system report on the serial port how far it got and what
# works (system/usr/lib/veil/veil-boot-report). Nothing is typed into the
# boot menu: each machine boots the way a person's would.
#
# Writes screenshots, serial logs and summary.md into the output directory,
# and exits non-zero if a machine did not reach its desktop or a check failed.
# Needs qemu-system-x86, qemu-utils, ovmf and python3-pil; uses KVM when present.

set -uo pipefail   # not -e: a machine that fails to boot is a result to record

ISO="$(readlink -f "${1:?usage: boot-test.sh ISO [OUTDIR]}")"
OUT="${2:-out/boot-test}"
mkdir -p "$OUT" && [ -w "$OUT" ] || { echo "Cannot write to $OUT" >&2; exit 2; }
OUT="$(readlink -f "$OUT")"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QMP="$HERE/qmp.py"
TESTS="${VEIL_TESTS:-uefi bios install}"

OVMF_CODE=/usr/share/OVMF/OVMF_CODE_4M.secboot.fd
OVMF_VARS=/usr/share/OVMF/OVMF_VARS_4M.ms.fd

# The installed system's user, as the install machine fills it in.
TEST_PASSWORD=veiltest

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
said() { grep -aq "VEIL-REPORT $1" "$SERIAL" 2>/dev/null; }

# The optical drive: AHCI on the modern machine, IDE on the older one, none
# once the system is installed.
ISO_DRIVE=(-drive "file=$ISO,media=cdrom,if=none,id=cd0,readonly=on")
CD_AHCI=("${ISO_DRIVE[@]}" -device ahci,id=ahci0 -device ide-cd,drive=cd0,bus=ahci0.0,bootindex=0)
CD_IDE=("${ISO_DRIVE[@]}" -device ide-cd,drive=cd0,bus=ide.1,bootindex=0)
CD_NONE=()

UEFI=(-machine q35,smm=on
      -global driver=cfi.pflash01,property=secure,value=on
      -drive "if=pflash,format=raw,unit=0,file=$OVMF_CODE,readonly=on")

# start_machine DIR SERIAL-NAME CD-ARRAY CREDENTIAL [qemu arguments...]
start_machine() {
    local dir="$1" name="$2"; shift 2
    local -n cd="$1"; shift
    local cred="$1"; shift
    mkdir -p "$dir"
    SOCK="$dir/qmp.sock"
    SERIAL="$dir/$name.log"
    rm -f "$SOCK"
    [ -f "$dir/disk.qcow2" ] || qemu-img create -q -f qcow2 "$dir/disk.qcow2" 40G
    qemu-system-x86_64 "${ACCEL[@]}" \
        -m 6144 -smp 4 \
        -device virtio-vga -display none \
        -device virtio-net-pci,netdev=n0 -netdev user,id=n0 \
        -device qemu-xhci -device usb-tablet \
        -drive "file=$dir/disk.qcow2,if=none,id=disk0,format=qcow2" \
        -device virtio-blk-pci,drive=disk0,bootindex=1 \
        "${cd[@]}" \
        -smbios "type=11,value=io.systemd.credential:veil.test=$cred" \
        -serial "file:$SERIAL" \
        -qmp "unix:$SOCK,server=on,wait=off" \
        -no-reboot \
        "$@" > "$dir/$name-qemu.log" 2>&1 &
    PID=$!
    for _ in $(seq 1 50); do [ -S "$SOCK" ] && return 0; sleep 0.2; done
    echo "QEMU did not start:"; cat "$dir/$name-qemu.log"
    return 1
}

stop_machine() {
    q --quit
    for _ in $(seq 1 20); do alive || break; sleep 0.5; done
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
}

# Wait for this machine's own exit, as a restart ends it (-no-reboot).
wait_exit() {
    local limit=$(( $1 * SLOW )) start=$SECONDS
    while alive && [ $((SECONDS - start)) -lt "$limit" ]; do sleep 2; done
    ! alive
}

shot() { q "$1" && echo "  screenshot $(basename "$1")"; }

# Pictures until the report says `done` or time runs out: every 20 seconds
# until the desktop is up, every 4 after that, so the apps the report opens
# are caught on screen. PREFIX names the pictures.
record() {
    local dir="$1" prefix="$2" limit=$(( $3 * SLOW )) n=0 next=0 every=20
    local start=$SECONDS
    while alive && [ $((SECONDS - start)) -lt "$limit" ]; do
        said done && break
        said stage=desktop && every=4
        if [ $((SECONDS - start)) -ge "$next" ]; then
            shot "$dir/$prefix-$(printf '%03d' "$n").png"
            n=$((n + 1))
            next=$(( SECONDS - start + every ))
        fi
        sleep 1
    done
    sleep 3
    shot "$dir/$prefix-final.png"
}

boot_pictures() {
    local dir="$1"
    sleep $((5 * SLOW));  shot "$dir/grub-menu.png"
    sleep $((12 * SLOW)); shot "$dir/splash-1.png"
    sleep $((6 * SLOW));  shot "$dir/splash-2.png"
}

# ------------------------------------------------------------------ uefi

uefi() {
    local dir="$OUT/uefi"
    log "UEFI with Secure Boot"
    if [ ! -f "$OVMF_CODE" ] || [ ! -f "$OVMF_VARS" ]; then
        echo "OVMF with Secure Boot is not installed (package ovmf)"
        return 1
    fi
    mkdir -p "$dir"
    cp "$OVMF_VARS" "$dir/vars.fd"
    start_machine "$dir" serial CD_AHCI 1 "${UEFI[@]}" \
        -drive "if=pflash,format=raw,unit=1,file=$dir/vars.fd" || return 1
    boot_pictures "$dir"
    record "$dir" boot 1200
    stop_machine
    rm -f "$dir/disk.qcow2" "$dir/vars.fd"
}

# ------------------------------------------------------------------ bios

bios() {
    local dir="$OUT/bios"
    log "Legacy BIOS"
    # An i440FX PC with an IDE drive: the kind of machine that still boots
    # this way.
    start_machine "$dir" serial CD_IDE 1 -machine pc || return 1
    boot_pictures "$dir"
    record "$dir" boot 1200
    stop_machine
    rm -f "$dir/disk.qcow2"
}

# --------------------------------------------------------------- install

# A key chord, then a moment for the installer to redraw, then a picture.
step() {
    local dir="$1" name="$2"; shift 2
    q --key "$@"
    sleep $((4 * SLOW))
    shot "$dir/install-$name.png"
}

install_test() {
    local dir="$OUT/install"
    log "Installing, UEFI with Secure Boot"
    mkdir -p "$dir"
    cp "$OVMF_VARS" "$dir/vars.fd"
    start_machine "$dir" live CD_AHCI install "${UEFI[@]}" \
        -drive "if=pflash,format=raw,unit=1,file=$dir/vars.fd" || return 1

    # The live session, with the installer opening by itself.
    local start=$SECONDS n=0
    while alive && ! said stage=installing && [ $((SECONDS - start)) -lt $((600 * SLOW)) ]; do
        sleep 10
        shot "$dir/live-$(printf '%03d' "$n").png"; n=$((n + 1))
    done
    said stage=installing || { echo "The live session never reached the installer"; stop_machine; return 1; }
    sleep $((25 * SLOW))
    shot "$dir/install-01-welcome.png"

    # Focus the installer's window by its title bar, then its own keyboard
    # shortcuts: Alt+N is Next, Alt+I is Install.
    q --click 640 91
    sleep 1
    step "$dir" 02-location  alt n
    step "$dir" 03-keyboard  alt n
    step "$dir" 04-partitions alt n
    step "$dir" 05-users     alt n
    # The users page puts the cursor in the name field, which the test
    # settings have filled; the password is the fourth field.
    q --key tab; q --key tab; q --key tab
    q --type "$TEST_PASSWORD"
    q --key tab
    q --type "$TEST_PASSWORD"
    sleep 2
    shot "$dir/install-06-users-filled.png"
    step "$dir" 07-summary   alt n
    step "$dir" 08-confirm   alt i
    step "$dir" 09-installing alt i

    # The installer runs; the report restarts the machine when it is done.
    start=$SECONDS; n=0
    while alive && [ $((SECONDS - start)) -lt $((3600 * SLOW)) ]; do
        sleep 60
        alive && shot "$dir/progress-$(printf '%03d' "$n").png"; n=$((n + 1))
        said install=failed && break
    done
    if ! said install=done; then
        echo "The installation did not finish"
        shot "$dir/install-stuck.png"
        stop_machine
        return 1
    fi
    wait_exit 120 || stop_machine

    # The installed system, from its own disk.
    log "Installed system"
    start_machine "$dir" installed CD_NONE install "${UEFI[@]}" \
        -drive "if=pflash,format=raw,unit=1,file=$dir/vars.fd" || return 1
    boot_pictures "$dir"
    # Sign in at the login screen once it is up: the one user is already
    # selected, so Enter asks for the password.
    start=$SECONDS
    while alive && ! said stage=graphical-target && [ $((SECONDS - start)) -lt $((300 * SLOW)) ]; do sleep 2; done
    sleep $((20 * SLOW))
    shot "$dir/login-screen.png"
    local attempt
    for attempt in 1 2 3; do
        said stage=desktop && break
        q --key ret
        sleep 3
        q --type "$TEST_PASSWORD"
        q --key ret
        sleep $((30 * SLOW))
        shot "$dir/login-$attempt.png"
        said stage=desktop || q --key esc
    done
    record "$dir" desktop 1200
    stop_machine
    rm -f "$dir/disk.qcow2" "$dir/vars.fd"
}

# ---------------------------------------------------------------- results

# One report's findings; prints problems and returns non-zero if there are any.
judge() {
    local title="$1" report="$2" uefi="$3" failed=0
    echo
    echo "## $title"
    echo
    echo '```'
    grep -a 'VEIL-REPORT' "$report" 2>/dev/null | sed 's/^.*VEIL-REPORT //' | tr -d '\r'
    echo '```'
    if ! grep -aq 'VEIL-REPORT stage=desktop' "$report" 2>/dev/null; then
        echo "- The desktop did not come up (see $(basename "$(dirname "$report")")/$(basename "$report") and the screenshots)."
        failed=1
    fi
    if ! grep -aq 'VEIL-REPORT done' "$report" 2>/dev/null; then
        echo "- The report did not finish."
        failed=1
    fi
    if [ "$uefi" = yes ] && ! grep -aq 'VEIL-REPORT secureboot=SecureBoot enabled' "$report" 2>/dev/null; then
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

for t in $TESTS; do
    case "$t" in
        uefi|bios) "$t" ;;
        install) install_test ;;
        *) echo "Unknown test: $t" ;;
    esac
done

{
    echo "# Veil OS boot test"
    echo
    echo "ISO: \`$(basename "$ISO")\` ($(du -h "$ISO" | cut -f1)); machines: $TESTS"
} > "$OUT/summary.md"
failed=0
for t in $TESTS; do
    case "$t" in
        uefi) judge "UEFI, live session" "$OUT/uefi/serial.log" yes >> "$OUT/summary.md" || failed=1 ;;
        bios) judge "BIOS, live session" "$OUT/bios/serial.log" no >> "$OUT/summary.md" || failed=1 ;;
        install)
            {
                echo
                echo "## Installing"
                echo
                echo '```'
                grep -a 'VEIL-REPORT' "$OUT/install/live.log" 2>/dev/null | sed 's/^.*VEIL-REPORT //' | tr -d '\r'
                echo '```'
            } >> "$OUT/summary.md"
            if grep -aq 'VEIL-REPORT install=done' "$OUT/install/live.log" 2>/dev/null; then
                judge "Installed system" "$OUT/install/installed.log" yes >> "$OUT/summary.md" || failed=1
            else
                echo "- The installation did not finish (see install/*.png)." >> "$OUT/summary.md"
                failed=1
            fi
            ;;
    esac
done
[ "$failed" -eq 0 ] && echo "Everything checked passed." >> "$OUT/summary.md"
cat "$OUT/summary.md"
exit "$failed"
