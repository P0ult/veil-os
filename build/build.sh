#!/bin/bash
# Build the Veil OS live ISO.
#
#     sudo ./build/build.sh              # everything
#     sudo ./build/build.sh chroot       # one stage (see STAGES below)
#
# Runs on Ubuntu, as root, with network. The method is the long-established one
# for a casper live image: debootstrap a system, configure it inside a chroot,
# squash it, and wrap it in an ISO that boots on BIOS and on UEFI with Secure
# Boot. Nothing here is Veil-specific except the scripts in build/chroot and
# the files they install.
#
# Host packages it needs are installed by the `host` stage.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=config.sh
source "$ROOT/build/config.sh"

WORK="${WORK:-/var/tmp/veil-build}"
CHROOT="$WORK/chroot"
IMAGE="$WORK/image"
OUT="${OUT:-$ROOT/out}"
STAGING="$WORK/staging"        # files handed into the chroot

STAGES=(host bootstrap payload chroot image iso)

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root."

# ----------------------------------------------------------------- mounts

mount_chroot() {
    mkdir -p "$CHROOT"/{dev/pts,proc,sys,run}
    mountpoint -q "$CHROOT/dev"     || mount --bind /dev "$CHROOT/dev"
    mountpoint -q "$CHROOT/dev/pts" || mount --bind /dev/pts "$CHROOT/dev/pts"
    mountpoint -q "$CHROOT/proc"    || mount -t proc proc "$CHROOT/proc"
    mountpoint -q "$CHROOT/sys"     || mount -t sysfs sysfs "$CHROOT/sys"
    mountpoint -q "$CHROOT/run"     || mount -t tmpfs tmpfs "$CHROOT/run"
}

unmount_chroot() {
    for m in run sys proc dev/pts dev; do
        mountpoint -q "$CHROOT/$m" && umount -lf "$CHROOT/$m" || true
    done
}

# A failed stage must never leave /dev bound inside a directory that the next
# run will try to delete.
trap unmount_chroot EXIT

# ------------------------------------------------------------------ stages

stage_host() {
    log "Host tools"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq \
        debootstrap squashfs-tools xorriso mtools dosfstools \
        grub-pc-bin grub-efi-amd64-bin grub-common \
        python3-pil curl ca-certificates jq
}

stage_bootstrap() {
    log "Bootstrapping Ubuntu ${UBUNTU_VERSION} (${UBUNTU_SUITE})"
    unmount_chroot
    rm -rf "$CHROOT"
    mkdir -p "$CHROOT"
    debootstrap --arch="$ARCH" --variant=minbase \
        --include=ca-certificates,gnupg \
        "$UBUNTU_SUITE" "$CHROOT" "$UBUNTU_MIRROR"
}

# Everything the chroot scripts install that does not come from apt: the
# brand assets, the installer config, the desktop defaults, and the .debs for
# the browser and Veil's own apps.
stage_payload() {
    log "Preparing what goes into the image"
    rm -rf "$STAGING"
    mkdir -p "$STAGING"/{debs,branding,installer,desktop,system}

    python3 "$ROOT/branding/generate.py"
    cp -a "$ROOT/branding/out/."        "$STAGING/branding/"
    cp -a "$ROOT/branding/plymouth"     "$STAGING/branding/plymouth-theme"
    cp -a "$ROOT/branding/grub"         "$STAGING/branding/grub-theme"
    cp -a "$ROOT/installer/."           "$STAGING/installer/"
    cp -a "$ROOT/desktop/."             "$STAGING/desktop/"
    cp -a "$ROOT/system/."              "$STAGING/system/"
    # The default layout, from the same definition Veil Appearance applies.
    python3 "$ROOT/desktop/generate-dconf.py" "$STAGING/desktop/dconf/10-layout"

    fetch_browser
    # Veil's own apps are built by CI before this runs, into apps/dist.
    if compgen -G "$ROOT/apps/dist/*.deb" > /dev/null; then
        cp "$ROOT"/apps/dist/*.deb "$STAGING/debs/"
    else
        die "No Veil app packages in apps/dist - build them first (see apps/README.md)."
    fi
    ls -la "$STAGING/debs"
}

fetch_browser() {
    local url="$VEIL_BROWSER_DEB_URL"
    if [ -z "$url" ]; then
        log "Finding the latest Veil Browser release"
        local auth=()
        [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
        url="$(curl -fsSL "${auth[@]}" "https://api.github.com/repos/${VEIL_BROWSER_REPO}/releases/latest" \
            | jq -r 'first(.assets[] | select(.name | test("amd64\\.deb$")) | .browser_download_url) // empty')" || true
    fi
    [ -n "$url" ] && [ "$url" != "null" ] || die \
        "No published Veil Browser .deb found. Publish a release of ${VEIL_BROWSER_REPO} - drafts are not downloadable - or set VEIL_BROWSER_DEB_URL."
    log "Veil Browser: $url"
    curl -fL --retry 3 -o "$STAGING/debs/veil-browser.deb" "$url"
}

stage_chroot() {
    log "Configuring the system"
    mount_chroot

    rm -rf "$CHROOT/tmp/veil"
    mkdir -p "$CHROOT/tmp/veil"
    cp -a "$STAGING/." "$CHROOT/tmp/veil/"
    cp "$ROOT/build/config.sh" "$CHROOT/tmp/veil/config.sh"
    cp -a "$ROOT/build/chroot" "$CHROOT/tmp/veil/steps"
    cp "$ROOT/build/packages/"*.list "$CHROOT/tmp/veil/"

    # The chroot resolves names through the host.
    cp /etc/resolv.conf "$CHROOT/etc/resolv.conf"

    for step in "$CHROOT"/tmp/veil/steps/[0-9]*.sh; do
        name="$(basename "$step")"
        log "  $name"
        chroot "$CHROOT" /usr/bin/env -i \
            HOME=/root \
            PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
            LANG=C.UTF-8 \
            DEBIAN_FRONTEND=noninteractive \
            GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
            /bin/bash -euo pipefail "/tmp/veil/steps/$name"
    done

    unmount_chroot
}

stage_image() {
    log "Laying out the image"
    rm -rf "$IMAGE"
    mkdir -p "$IMAGE"/{casper,isolinux,boot/grub/themes,.disk,EFI/boot}

    # The live system boots the newest kernel in the chroot.
    local kernel initrd
    kernel="$(ls -1 "$CHROOT"/boot/vmlinuz-* | sort -V | tail -n1)"
    initrd="$(ls -1 "$CHROOT"/boot/initrd.img-* | sort -V | tail -n1)"
    [ -f "$kernel" ] && [ -f "$initrd" ] || die "No kernel or initrd in the chroot."
    cp "$kernel" "$IMAGE/casper/vmlinuz"
    cp "$initrd" "$IMAGE/casper/initrd"

    # The package lists casper and the installer read.
    chroot "$CHROOT" dpkg-query -W --showformat='${Package} ${Version}\n' \
        > "$IMAGE/casper/filesystem.manifest"
    cp "$IMAGE/casper/filesystem.manifest" "$IMAGE/casper/filesystem.manifest-desktop"
    # What the installer removes from the installed system, so casper's own
    # accounting agrees with Calamares's packages step.
    printf '%s\n' calamares calamares-settings-ubuntu-common casper veil-installer \
        > "$IMAGE/casper/filesystem.manifest-remove"

    # Disk identity: the signed GRUB finds the image by looking for .disk/info.
    printf '%s %s "%s" - Release %s (%s)\n' \
        "$VEIL_OS_NAME" "$VEIL_OS_VERSION" "$VEIL_OS_CODENAME" "$ARCH" "$(date -u +%Y%m%d)" \
        > "$IMAGE/.disk/info"
    touch "$IMAGE/.disk/base_installable"
    echo "full_cd/single" > "$IMAGE/.disk/cd_type"
    echo "$VEIL_OS_HOME" > "$IMAGE/.disk/release_notes_url"
    cat > "$IMAGE/README.diskdefines" <<EOF
#define DISKNAME  ${VEIL_OS_NAME} ${VEIL_OS_VERSION} "${VEIL_OS_CODENAME}" - ${ARCH}
#define TYPE  binary
#define TYPEbinary  1
#define ARCH  ${ARCH}
#define ARCH${ARCH}  1
#define DISKNUM  1
#define DISKNUM1  1
#define TOTALNUM  0
#define TOTALNUM0  1
EOF

    # The boot menu and its theme.
    cp -a "$CHROOT/usr/share/grub/themes/veil" "$IMAGE/boot/grub/themes/veil"
    sed "s/@VERSION@/${VEIL_OS_VERSION}/g" "$ROOT/build/iso/grub.cfg" > "$IMAGE/boot/grub/grub.cfg"
    cp "$ROOT/build/iso/loopback.cfg" "$IMAGE/boot/grub/loopback.cfg"
    # `loadfont unicode` finds this on BIOS; the signed UEFI GRUB has its own.
    mkdir -p "$IMAGE/boot/grub/fonts"
    cp "$CHROOT/usr/share/grub/unicode.pf2" "$IMAGE/boot/grub/fonts/unicode.pf2"

    log "Squashing the system (this is the slow part)"
    mksquashfs "$CHROOT" "$IMAGE/casper/filesystem.squashfs" \
        -noappend -no-duplicates -no-recovery -wildcards \
        "${SQUASHFS_COMP[@]}" \
        -e "proc/*" -e "sys/*" -e "dev/*" -e "run/*" -e "tmp/*" \
        -e "var/cache/apt/archives/*.deb" -e "var/lib/apt/lists/*" \
        -e "root/.bash_history" -e "etc/resolv.conf"

    # The installer shows this as the space the system needs.
    du -sx --block-size=1 "$CHROOT" | cut -f1 > "$IMAGE/casper/filesystem.size"

    boot_bios
    boot_uefi

    # Less the boot images, which xorriso patches as it writes them.
    (cd "$IMAGE" && find . -type f -print0 | xargs -0 md5sum | grep -v -e 'md5sum.txt' -e 'eltorito.img' -e 'efiboot.img' > md5sum.txt)
}

# BIOS: GRUB laid out the way Ubuntu lays it out on its own ISOs - a small El
# Torito image whose prefix is /boot/grub on the disk it started from, with
# its modules beside it. It needs no search and no second config: it reads
# /boot/grub/grub.cfg directly, and loads what that asks for from the disk.
boot_bios() {
    log "BIOS boot image"
    local mods="$CHROOT/usr/lib/grub/i386-pc"
    [ -f "$mods/cdboot.img" ] || die "No BIOS GRUB in the chroot (grub-pc-bin)."
    mkdir -p "$IMAGE/boot/grub/i386-pc"
    cp "$mods"/*.mod "$mods"/*.lst "$IMAGE/boot/grub/i386-pc/"
    grub-mkimage -d "$mods" -O i386-pc-eltorito -p /boot/grub \
        -o "$IMAGE/boot/grub/i386-pc/eltorito.img" \
        biosdisk iso9660 part_msdos part_gpt
    cp "$mods/boot_hybrid.img" "$WORK/boot_hybrid.img"
}

# UEFI: Ubuntu's own signed shim and its CD-specific signed GRUB, so the image
# boots with Secure Boot on. gcdx64 is the build Ubuntu puts on its own ISOs:
# it looks for .disk/info and reads /boot/grub/grub.cfg from the same disk.
boot_uefi() {
    log "UEFI boot image"
    local shim="" grub mm candidate
    # The first that exists. Not `ls a b | head`: ls fails when either is
    # missing, and under pipefail that ends the build.
    for candidate in "$CHROOT"/usr/lib/shim/shimx64.efi.signed.latest \
                     "$CHROOT"/usr/lib/shim/shimx64.efi.signed; do
        if [ -f "$candidate" ]; then shim="$candidate"; break; fi
    done
    mm="$CHROOT/usr/lib/shim/mmx64.efi"
    grub="$CHROOT/usr/lib/grub/x86_64-efi-signed/gcdx64.efi.signed"
    [ -f "$shim" ] || die "No signed shim in the chroot (shim-signed)."
    [ -f "$grub" ] || die "No signed CD GRUB in the chroot (grub-efi-amd64-signed)."

    cp "$shim" "$IMAGE/EFI/boot/bootx64.efi"
    cp "$grub" "$IMAGE/EFI/boot/grubx64.efi"
    [ -f "$mm" ] && cp "$mm" "$IMAGE/EFI/boot/mmx64.efi"

    local img="$IMAGE/isolinux/efiboot.img"
    dd if=/dev/zero of="$img" bs=1M count=10 status=none
    mkfs.vfat -n VEIL_EFI "$img" > /dev/null
    mmd -i "$img" ::EFI ::EFI/boot
    mcopy -i "$img" "$IMAGE/EFI/boot/bootx64.efi" "$IMAGE/EFI/boot/grubx64.efi" ::EFI/boot/
    [ -f "$IMAGE/EFI/boot/mmx64.efi" ] && mcopy -i "$img" "$IMAGE/EFI/boot/mmx64.efi" ::EFI/boot/
    return 0
}

stage_iso() {
    log "Writing the ISO"
    mkdir -p "$OUT"
    (
        cd "$IMAGE"
        xorriso -as mkisofs \
            -iso-level 3 \
            -full-iso9660-filenames \
            -joliet -joliet-long -rational-rock \
            -volid "$ISO_LABEL" \
            -output "$OUT/$ISO_NAME" \
            -eltorito-boot boot/grub/i386-pc/eltorito.img \
                -no-emul-boot -boot-load-size 4 -boot-info-table \
                --eltorito-catalog boot/grub/boot.cat \
                --grub2-boot-info \
                --grub2-mbr "$WORK/boot_hybrid.img" \
            -eltorito-alt-boot \
                -e EFI/efiboot.img \
                -no-emul-boot \
            -append_partition 2 0xef isolinux/efiboot.img \
            -m "isolinux/efiboot.img" \
            -graft-points \
                "/EFI/efiboot.img=isolinux/efiboot.img" \
                "."
    )
    (cd "$OUT" && sha256sum "$ISO_NAME" > "$ISO_NAME.sha256")
    log "Done: $OUT/$ISO_NAME ($(du -h "$OUT/$ISO_NAME" | cut -f1))"
}

# ------------------------------------------------------------------- main

if [ $# -eq 0 ]; then
    run=("${STAGES[@]}")
else
    run=("$@")
fi

for stage in "${run[@]}"; do
    case " ${STAGES[*]} " in
        *" $stage "*) "stage_$stage" ;;
        *) die "Unknown stage: $stage (stages: ${STAGES[*]})" ;;
    esac
done
