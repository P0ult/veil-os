# Veil OS boot test

ISO: `veil-os-1.0-amd64.iso` (3.2G); machines: uefi

## UEFI, live session

```
stage=graphical-target
mode=1 live=yes user=veil
os=Veil OS 1.0
kernel=7.0.0-31-generic
secureboot=SecureBoot enabled
cmdline=BOOT_IMAGE=/casper/vmlinuz boot=casper quiet splash ---
stage=desktop seconds=2
session=[DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority XDG_CURRENT_DESKTOP=GNOME XDG_SESSION_TYPE=x11]
check plymouth-theme=ok
check wine=ok
check winetricks=ok
check steam=ok
check lutris=ok
check libreoffice=ok
check vlc=ok
check veil-browser=ok
check veil-store=ok
check veil-appearance=ok
check flathub=ok
check i386-arch=ok
check vulkan-i386=ok
check mesa-kisak=ok
check dash-to-panel=ok
check arcmenu=ok
check blur-my-shell=ok
check theme-colloid=ok
check no-snapd=ok
check os-release=ok
check apt-template=ok
check add-apt-repo=ok
check apparmor-apps=ok
check owners=ok
check dpkg-clean=ok
apparmor service=inactive loaded=95 veil=[veil-center (unconfined);veil-browser (unconfined);] restrict_userns=1
check calamares=ok
check bootloader-debs=ok
preload=inactive veil-live-preload.service: Consumed 20.478s CPU time.
check browser-icon=ok
enabled-extensions=['dash-to-panel@jderose9.github.com', 'arcmenu@arcmenu.com', 'blur-my-shell@aunetx', 'user-theme@gnome-shell-extensions.gcampax.github.com', 'ubuntu-appindicators@ubuntu.com', 'ding@rastersoft.com']
gtk-theme='Colloid-Green-Dark'
extension dash-to-panel@jderose9.github.com state=1.0
extension arcmenu@arcmenu.com state=1.0
extension blur-my-shell@aunetx state=1.0
extension user-theme@gnome-shell-extensions.gcampax.github.com state=1.0
extension ubuntu-appindicators@ubuntu.com state=1.0
extension ding@rastersoft.com state=1.0
memory=5882MB total, 4616MB available
reread-binary=1s
stage=apps
window store: veil-store on screen after 32s
  store | [veil-center store] starting 44.2.0 --store
  store | [veil-center store] window created
  store | libva error: /usr/lib/x86_64-linux-gnu/dri/virtio_gpu_drv_video.so init failed
  store | [3116:0918/003947.076612:ERROR:media/gpu/vaapi/vaapi_wrapper.cc:1801] vaInitialize failed: resource allocation failed
  store | [veil-center store] showing window: timeout
  store | [veil-center store] page loaded
check store-starts=ok
window appearance: veil-appearance on screen after 2s
  appearance | [3433:0918/004045.805860:ERROR:content/common/zygote/zygote_communication_linux.cc:291] Failed to send GetTerminationStatus message to zygote
  appearance | [3433:0918/004045.808597:ERROR:content/common/zygote/zygote_communication_linux.cc:291] Failed to send GetTerminationStatus message to zygote
  appearance | [3433:0918/004045.810596:ERROR:content/browser/network_service_instance_impl.cc:650] Network service crashed or was terminated, restarting service.
  appearance | [3433:0918/004045.818780:ERROR:content/browser/gpu/gpu_process_host.cc:1029] GPU process launch failed: error_code=1002
  appearance | [3433:0918/004045.820304:ERROR:content/browser/gpu/gpu_process_host.cc:1029] GPU process launch failed: error_code=1002
  appearance | [3433:0918/004045.820925:ERROR:content/browser/gpu/gpu_process_host.cc:1029] GPU process launch failed: error_code=1002
  appearance | [3433:0918/004045.820943:FATAL:content/browser/gpu/gpu_data_manager_impl_private.cc:417] GPU process isn't usable. Goodbye.
  appearance | timeout: the monitored command dumped core
check appearance-starts=ok
window browser: veil on screen after 8s
  browser |   Manifest version 2 is deprecated, and support will be removed in 2025. See https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline for details.
  browser |   Permission 'contextMenus' is unknown or URL pattern is malformed.
  browser |   Permission 'privacy' is unknown or URL pattern is malformed.
  browser |   Permission 'webNavigation' is unknown or URL pattern is malformed.
  browser | 
  browser | (Use `veil-browser --trace-warnings ...` to show where the warning was created)
  browser | [ubo] uBlock Origin 1.74.0 loaded
  browser | [adblock] refreshed 6/7 lists, 120434 rules
check browser-starts=ok
shell: Error looking up permission: GDBus.Error:org.freedesktop.portal.Error.NotFound: No entry for geolocation
done
```
Everything checked passed.
