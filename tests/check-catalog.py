#!/usr/bin/env python3
"""
Every app the Veil Store names, checked against where it comes from.

Flatpak ids are asked of Flathub; apt names are checked against the noble
archive; the local entries must be the ones the image actually installs or
that the archive carries. A wrong id is a Store tile whose Install button does
nothing, which is worse than no tile.

    python3 tests/check-catalog.py
"""

import json
import lzma
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, '..', 'apps', 'veil-center', 'data', 'catalog.json')


def flathub_has(app_id):
    url = f'https://flathub.org/api/v2/appstream/{app_id}'
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.load(r)
            return bool(data and data.get('id')), data.get('name')
    except urllib.error.HTTPError as e:
        return False, f'HTTP {e.code}'
    except Exception as e:
        return False, str(e)


def archive_names():
    names = set()
    for suite in ('noble', 'noble-updates'):
        for comp in ('main', 'universe', 'multiverse', 'restricted'):
            url = f'http://archive.ubuntu.com/ubuntu/dists/{suite}/{comp}/binary-amd64/Packages.xz'
            raw = urllib.request.urlopen(url, timeout=120).read()
            for line in lzma.decompress(raw).decode('utf-8', 'replace').splitlines():
                if line.startswith('Package: '):
                    names.add(line[9:].strip())
    return names


def main():
    cat = json.load(open(CATALOG, encoding='utf-8'))
    local = cat['local']

    ids = set(cat['featured'])
    for c in cat['categories']:
        ids.update(c['apps'])
    for w in cat['windows']:
        ids.update(w['use'])

    bad = []

    flatpaks = sorted(i for i in ids if i not in local)
    print(f'{len(flatpaks)} Flathub apps')
    for app_id in flatpaks:
        ok, detail = flathub_has(app_id)
        if not ok:
            bad.append(f'Flathub has no {app_id} ({detail})')

    archive = archive_names()
    for key, entry in sorted(local.items()):
        pkg = entry['apt']
        if pkg == 'veil-browser':
            continue            # Veil's own, from its own releases
        if pkg not in archive:
            bad.append(f'the archive has no {pkg} (for {key})')

    unknown = [i for i in ids if '.' not in i and i not in local]
    for i in unknown:
        bad.append(f'{i} looks like a local id but has no entry in "local"')

    for line in bad:
        print('  ' + line)
    if bad:
        print(f'{len(bad)} problems')
        return 1
    print('every catalog entry exists')
    return 0


if __name__ == '__main__':
    sys.exit(main())
