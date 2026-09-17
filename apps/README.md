# Veil's own apps

The ISO build installs every `.deb` it finds in `apps/dist/`, alongside the
latest published Veil Browser. CI builds them before the image; on your own
machine, build them first:

```sh
apps/veil-center/build-deb.sh     # writes apps/dist/veil-center_<version>_amd64.deb
sudo build/build.sh
```

## Veil Center

One Electron program with two windows, installed as two apps:

- **Veil Store** (`veil-store`) installs apps from Flathub and from Ubuntu's
  archive, and has a "What did you use on Windows?" guide that maps familiar
  Windows programs to their Linux counterparts. Its shelves are
  `veil-center/data/catalog.json`.
- **Veil Appearance** (`veil-appearance`) switches between six desktop layouts
  and changes the accent colour, light or dark mode, wallpaper, taskbar
  position, size, opacity and blur, typeface, text scale, pointer and window
  buttons. Its layouts are `desktop/layouts.json` - the same file the build
  uses for the default desktop, copied into the app by `build-deb.sh`.

Nothing in Appearance needs a password. The Store installs Flathub apps
system-wide through `flatpak`, and Ubuntu packages through a small root helper
(`helper/veil-store-helper`) that polkit asks the administrator's password
for. The helper does three things - install, remove, upgrade - and checks
every package name before apt sees it.

### Working on it anywhere

```sh
cd apps/veil-center
npm install
npx electron . --mock                 # the Store
npx electron . --appearance --mock    # Appearance
npm test
```

`--mock` swaps gsettings, flatpak, apt and the filesystem for in-memory
stand-ins, so both windows run on Windows or macOS without touching anything.
The Store still asks Flathub for real app details.
