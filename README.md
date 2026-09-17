# Veil OS

A desktop Linux for people coming from Windows, built on Ubuntu 24.04 LTS.
It looks and works like the Windows desktop you know by default, runs Windows
programs and games out of the box, and lets you rearrange almost everything
about how it looks.

Veil OS is the operating-system companion to
[Veil Browser](https://github.com/P0ult/veil-browser), and ships with it.

## What you get

**The desktop.** GNOME 46 with a taskbar, a start menu and six layouts you
can switch between in Veil Appearance: Classic (Windows 10), Modern
(Windows 11), Dock (macOS), Traditional (Linux Mint), Touch, and plain GNOME.
Nine accent colours, light and dark mode, frosted-glass panels, wallpapers,
taskbar position, size and opacity, typefaces, text scale, pointers and
window-button placement are all one click each. The theme is
[Colloid](https://github.com/vinceliuice/Colloid-gtk-theme) with
[Papirus](https://github.com/PapirusDevelopmentTeam/papirus-icon-theme) icons
and [Bibata](https://github.com/ful1e5/Bibata_Cursor) pointers.

**Veil from the first second.** The Veil mark on the boot menu, a boot
animation of its own, the login screen, the About page and the installer.

**Windows programs.** Wine from WineHQ, with winetricks. Double-click an
`.exe` or `.msi` and it runs; the first time, Veil sets up a Windows
environment with DXVK and VKD3D so DirectX 9 to 12 run through Vulkan.
Bottles is a click away in the Store for anything that needs its own setup.

**Games.** Steam (with Proton), Lutris, GameMode and MangoHud, the newest Mesa
graphics drivers from the kisak PPA, and 32-bit graphics libraries so older
and Windows games get hardware acceleration. On the first boot of an installed
system, Veil detects an NVIDIA card and installs the driver Ubuntu recommends
for it, 32-bit half included.

**Apps.** LibreOffice, VLC, Veil Browser, and the **Veil Store**: Flathub's
whole catalogue plus the handful of apps that belong in the base system, with a
"What did you use on Windows?" guide that points Photoshop users at GIMP and
Krita, Office users at LibreOffice and ONLYOFFICE, and so on.

**No snaps.** Everything is a Debian package or a Flatpak.

## Installing

1. Download every `veil-os-*.iso.part*` file from a
   [release](https://github.com/P0ult/veil-os/releases), with `join.sh` and
   `join.cmd`. The ISO is larger than GitHub allows for one file.
2. Put the parts back together: run `join.cmd` on Windows, or `sh join.sh` on
   Linux or macOS. Both check the result against the published checksum.
3. Write the ISO to a USB stick of 8 GB or more with
   [Rufus](https://rufus.ie), [balenaEtcher](https://etcher.balena.io) or
   [Ventoy](https://www.ventoy.net).
4. Boot from the stick and choose **Try or install Veil OS**. The installer
   opens by itself.

Secure Boot can stay on: Veil OS boots through Ubuntu's signed boot loader
and kernel. If the screen stays black on a machine with an NVIDIA card, choose
**Veil OS with safe graphics** instead; the proper driver is installed on the
first boot after installing.

Minimum: a 64-bit PC, 4 GB of memory (8 GB for games), 25 GB of disk.

## Building

On Ubuntu 24.04, as root, with a network connection and about 40 GB free:

```sh
apps/veil-center/build-deb.sh    # Veil Store and Veil Appearance (needs Node.js 20+)
sudo build/build.sh              # writes out/veil-os-<version>-amd64.iso
tests/boot-test.sh out/veil-os-*.iso out/boot-test   # optional: boot it in QEMU
```

The build downloads the newest *published* release of Veil Browser. Drafts
cannot be downloaded, so publish one first, or point `VEIL_BROWSER_DEB_URL`
at a `.deb`.

`build/build.sh` runs in stages - `host`, `bootstrap`, `payload`, `chroot`,
`image`, `iso` - and one can be rerun on its own, for example
`sudo build/build.sh chroot image iso`.

GitHub Actions does all of this on every push (`.github/workflows/build-iso.yml`):
it checks every package name against the Ubuntu archive and every Store entry
against Flathub, builds the ISO, boots it with UEFI Secure Boot and with BIOS,
installs it onto a virtual disk and boots the installed system, and records
screenshots and a report of what works (`tests/boot-test.sh`). The logs and
screenshots of the latest run are on the `ci-logs` branch. Pushing a tag such
as `os-v1.0` also creates a draft release with the ISO.

## Where things are

| Path | What it is |
| --- | --- |
| `build/` | The ISO build: `config.sh` for choices, `chroot/` for the steps run inside the new system, `packages/` for what is installed |
| `branding/` | The logo sources and `generate.py`, which makes every icon, wallpaper, boot frame and installer slide from them |
| `desktop/` | Default desktop settings, and `layouts.json`, the six layouts |
| `installer/` | Calamares configuration and branding |
| `system/` | Veil's own system files: Windows program launcher, first-boot driver setup, boot-test report |
| `apps/veil-center/` | Veil Store and Veil Appearance |
| `tests/` | Archive, Flathub and boot tests |

## Names and licences

Veil OS is built from Ubuntu but is not Ubuntu and is not endorsed by
Canonical. Ubuntu's name and logo are removed from the image: the system
identifies itself as Veil OS while remaining compatible with software made for
Ubuntu 24.04.

Veil OS's own code is under the GNU General Public License, version 3 or later
(see `LICENSE`). Each package in the image keeps its own licence; the Colloid
theme, Papirus icons, Bibata cursors and the GNOME Shell extensions (Dash to
Panel, ArcMenu, Blur my Shell) are GPL-licensed projects by their authors.
