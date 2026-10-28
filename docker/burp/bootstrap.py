"""Local GUI setup for the pinned Community build; no remote desktop listener.

Only a fresh in-memory project is configured. Never touches an external Burp.
Coordinates are tied to 2026.10.1 and the fixed Xvfb screen; upgrades must rerun
our real-instance acceptance test. Failure never produces a healthy service.
"""
import json
import os
import socket
import subprocess
import time


def xdo(*args):
    return subprocess.check_output(['xdotool', *args], text=True, stderr=subprocess.DEVNULL).strip()


def listening(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=.2):
            return True
    except OSError:
        return False


for attempt in range(120):
    try:
        windows = xdo('search', '--onlyvisible', '--class', 'burp-StartBurp').splitlines()
        for window in windows:
            name = xdo('getwindowname', window)
            if 'Temporary Project' in name:
                break
            geometry = dict(line.split('=', 1) for line in xdo('getwindowgeometry', '--shell', window).splitlines())
            # Startup wizard: Next / Start Burp, not arbitrary application buttons.
            if 810 <= int(geometry['WIDTH']) <= 820 and 510 <= int(geometry['HEIGHT']) <= 520:
                xdo('mousemove', str(int(geometry['X']) + 760), str(int(geometry['Y']) + 484), 'click', '1')
    except subprocess.CalledProcessError:
        pass
    if listening(9876):
        break
    time.sleep(.5)
else:
    raise RuntimeError('Official Burp extension failed to start; inspect the pinned GUI setup')

# Fresh temporary project => official extension starts with its default toggles.
# Retain filtered configuration and disabled config-editing. The private scoped
# relay supplies per-program active permission, destination checks and UA.
xdo('mousemove', '986', '55', 'click', '1')
time.sleep(.5)
xdo('mousemove', '697', '245', 'click', '1')  # HTTP approvals delegated to scoped relay
xdo('mousemove', '713', '298', 'click', '1')  # Allow scoped relay to read existing HTTP history
xdo('mousemove', '713', '341', 'click', '1')  # Same for attributable Organizer HTTP items
with open('/tmp/bughunter-burp-ready', 'w') as ready:
    json.dump({'burp': '2026.10.1', 'extension': '1.3.0', 'edition': 'Community', 'bind': '127.0.0.1'}, ready)
print('Burp Community and official MCP listening on loopback; scoped client enforces target permissions.', flush=True)
