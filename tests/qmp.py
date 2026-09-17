#!/usr/bin/env python3
"""
Drive a running QEMU through its QMP socket.

    python3 tests/qmp.py SOCKET shot.png             # screenshot, as PNG
    python3 tests/qmp.py SOCKET --key up             # one key
    python3 tests/qmp.py SOCKET --key ctrl x         # a chord
    python3 tests/qmp.py SOCKET --type "some text"   # text, key by key
    python3 tests/qmp.py SOCKET --click 640 400      # a left click at a pixel
    python3 tests/qmp.py SOCKET --quit               # stop the machine

QEMU writes screenshots as PPM; Pillow turns them into PNG so they can be
looked at anywhere. Exits non-zero when the machine is not there any more.
"""

import json
import os
import socket
import sys
import tempfile
import time

from PIL import Image

# Characters the boot test types, as QEMU key codes.
CHARS = {' ': 'spc', '.': 'dot', '=': 'equal', ',': 'comma', '-': 'minus', '/': 'slash', '_': ('shift', 'minus')}


class Machine:
    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(30)
        self.sock.connect(path)
        self.f = self.sock.makefile('rw')
        self.f.readline()  # greeting
        self.call('qmp_capabilities')

    def call(self, command, arguments=None):
        msg = {'execute': command}
        if arguments:
            msg['arguments'] = arguments
        self.f.write(json.dumps(msg) + '\n')
        self.f.flush()
        # Events can arrive before the answer; skip them.
        while True:
            line = self.f.readline()
            if not line:
                raise RuntimeError('QEMU closed the connection')
            reply = json.loads(line)
            if 'error' in reply:
                raise RuntimeError(reply['error'].get('desc', reply['error']))
            if 'return' in reply:
                return reply['return']

    def keys(self, names):
        self.call('send-key', {'keys': [{'type': 'qcode', 'data': n} for n in names], 'hold-time': 60})

    def type(self, text):
        for ch in text:
            if ch.isalpha() and ch.isupper():
                names = ['shift', ch.lower()]
            elif ch.isalnum():
                names = [ch]
            else:
                code = CHARS[ch]
                names = list(code) if isinstance(code, tuple) else [code]
            self.keys(names)
            time.sleep(0.05)

    def size(self):
        """The screen's size, from a screendump's PPM header."""
        ppm = os.path.join(tempfile.gettempdir(), f'veil-size-{os.getpid()}.ppm')
        self.call('screendump', {'filename': ppm})
        for _ in range(20):
            if os.path.exists(ppm) and os.path.getsize(ppm) > 20:
                break
            time.sleep(0.1)
        time.sleep(0.1)
        with Image.open(ppm) as im:
            w, h = im.size
        os.remove(ppm)
        return w, h

    def click(self, x, y, button='left'):
        """A click at screen pixel (x, y), through the USB tablet."""
        w, h = self.size()
        ax = round(int(x) * 32767 / max(1, w - 1))
        ay = round(int(y) * 32767 / max(1, h - 1))
        self.call('input-send-event', {'events': [
            {'type': 'abs', 'data': {'axis': 'x', 'value': ax}},
            {'type': 'abs', 'data': {'axis': 'y', 'value': ay}},
        ]})
        time.sleep(0.15)
        for down in (True, False):
            self.call('input-send-event', {'events': [
                {'type': 'btn', 'data': {'down': down, 'button': button}},
            ]})
            time.sleep(0.08)

    def screenshot(self, target):
        ppm = os.path.join(tempfile.gettempdir(), f'veil-shot-{os.getpid()}.ppm')
        self.call('screendump', {'filename': ppm})
        # screendump can return before the file is complete.
        for _ in range(20):
            if os.path.exists(ppm) and os.path.getsize(ppm) > 0:
                break
            time.sleep(0.1)
        time.sleep(0.2)
        Image.open(ppm).save(target)
        os.remove(ppm)

    def close(self):
        self.sock.close()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    path, what, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
    try:
        m = Machine(path)
        if what == '--quit':
            m.call('quit')
        elif what == '--key':
            m.keys(rest)
        elif what == '--type':
            m.type(' '.join(rest))
        elif what == '--click':
            m.click(rest[0], rest[1])
        else:
            m.screenshot(what)
        m.close()
        return 0
    except (OSError, RuntimeError, KeyError) as e:
        print(f'qmp: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
