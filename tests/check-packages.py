#!/usr/bin/env python3
"""
Every package the build asks for, checked against the real archive.

A single wrong name fails `apt-get install` for the whole list, and finding
that out forty minutes into a CI build is a poor way to learn it. This reads
the noble indexes directly - main, universe, multiverse and restricted, for
amd64 and i386, release and updates - and reports anything not there.

    python3 tests/check-packages.py
"""

import lzma
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LISTS = os.path.join(HERE, '..', 'build', 'packages')
DEB_SCRIPT = os.path.join(HERE, '..', 'apps', 'veil-center', 'build-deb.sh')

MIRROR = 'http://archive.ubuntu.com/ubuntu'
SUITES = ['noble', 'noble-updates']
COMPONENTS = ['main', 'restricted', 'universe', 'multiverse']
ARCHES = ['amd64', 'i386']


def index(suite, component, arch):
    url = f'{MIRROR}/dists/{suite}/{component}/binary-{arch}/Packages.xz'
    raw = urllib.request.urlopen(url, timeout=120).read()
    names = set()
    provides = set()
    for line in lzma.decompress(raw).decode('utf-8', 'replace').splitlines():
        if line.startswith('Package: '):
            names.add(line[9:].strip())
        elif line.startswith('Provides: '):
            for part in line[10:].split(','):
                provides.add(part.strip().split(' ')[0])
    return names, provides


def main():
    have = {a: set() for a in ARCHES}
    virtual = {a: set() for a in ARCHES}
    for arch in ARCHES:
        for suite in SUITES:
            for comp in COMPONENTS:
                try:
                    n, p = index(suite, comp, arch)
                except Exception as e:
                    print(f'  could not read {suite}/{comp}/{arch}: {e}')
                    continue
                have[arch] |= n
                virtual[arch] |= p
        print(f'{arch}: {len(have[arch])} packages indexed')

    wanted = []
    for name in sorted(os.listdir(LISTS)):
        if not name.endswith('.list'):
            continue
        for raw in open(os.path.join(LISTS, name), encoding='utf-8'):
            line = raw.split('#', 1)[0].strip()
            if line:
                wanted.append((name, line))
    # The Veil Center package's own dependencies, which apt resolves when the
    # build installs it. A virtual name is fine there, as long as it exists.
    for line in open(DEB_SCRIPT, encoding='utf-8'):
        if line.startswith('Depends:'):
            for dep in line[len('Depends:'):].split(','):
                wanted.append(('veil-center Depends', dep.split('(')[0].strip()))

    missing = []
    virtual_only = []
    for name, line in wanted:
        pkg, _, arch = line.partition(':')
        arch = arch or 'amd64'
        if pkg in have[arch]:
            continue
        if pkg in virtual[arch]:
            if name != 'veil-center Depends':
                virtual_only.append((name, line))
        else:
            missing.append((name, line))

    for name, line in virtual_only:
        print(f'  virtual only (apt will need a real package): {name}: {line}')
    for name, line in missing:
        print(f'  MISSING: {name}: {line}')

    if missing or virtual_only:
        print(f'{len(missing)} missing, {len(virtual_only)} virtual')
        return 1
    print('every package exists')
    return 0


if __name__ == '__main__':
    sys.exit(main())
