#!/usr/bin/env python3
"""
Write the default desktop layout as a dconf keyfile.

Reads desktop/layouts.json - the same file Veil Appearance applies layouts
from - and writes the default layout's settings as system dconf defaults, so
the desktop a new user sees and the layout Appearance calls by that name are
one definition rather than two that drift.

    python3 desktop/generate-dconf.py OUT_FILE
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MONITORS = range(6)
DTP = 'org.gnome.shell.extensions.dash-to-panel'


def schema_path(schema):
    return schema.replace('.', '/')


def per_monitor(value, elements):
    """A layout's per-monitor value, for monitor indexes 0-5, as JSON text."""
    if isinstance(value, str) and value.startswith('@'):
        value = elements[value[1:]]
    return json.dumps({str(i): value for i in MONITORS}, separators=(',', ':'))


def gvariant_string(text):
    # JSON uses double quotes only, so single-quoting it is safe - but a
    # stray single quote would end the string early, so refuse rather than
    # write a file dconf will reject.
    if "'" in text or '\\' in text:
        raise ValueError('cannot single-quote: ' + text[:60])
    return "'" + text + "'"


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    data = json.load(open(os.path.join(HERE, 'layouts.json'), encoding='utf-8'))
    name = data['default']
    layout = data['layouts'][name]
    elements = data['elements']

    sections = {}

    def put(schema, key, value):
        sections.setdefault(schema_path(schema), []).append(f'{key}={value}')

    for schema, key, value in layout['settings']:
        put(schema, key, value)

    # The per-monitor maps are cleared of any monitor-serial keys and written by
    # index, which Dash to Panel reads when it has nothing keyed by serial.
    for key, value in layout.get('perMonitor', {}).items():
        put(DTP, key, gvariant_string(per_monitor(value, elements)))

    # Monitor-serial entries would outrank these; there are none on a fresh
    # system, and writing an empty map for sizes and positions makes the
    # single-value panel-size and panel-position keys apply to every screen.
    put(DTP, 'panel-sizes', "'{}'")
    put(DTP, 'panel-positions', "'{}'")

    lines = [
        f'# The "{layout["name"]}" layout, generated from desktop/layouts.json.',
        '# Edit that file, not this one.',
        '',
    ]
    for path, entries in sections.items():
        lines.append(f'[{path}]')
        lines.extend(entries)
        lines.append('')

    with open(sys.argv[1], 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
    print(f'wrote the {name} layout to {sys.argv[1]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
