#!/usr/bin/python3
import json
import os
import select
import socket
import sys
connection = socket.socket(socket.AF_UNIX)
connection.connect('/run/bughunter-broker/control.sock')
# Arguments originate in the trusted service, never the browser command line.
request = json.loads(sys.stdin.read(4096) if sys.argv[1:] == ['--request-stdin'] else sys.argv[1])
connection.sendall(json.dumps(request).encode() + b'\n')
header = bytearray()
while len(header) < 65536:
    part = connection.recv(1)
    if not part or part == b'\n':
        break
    header.extend(part)
response = json.loads(header)
if response.get('error'):
    sys.exit(1)
if response.get('stream'):
    import tty
    import termios
    old = termios.tcgetattr(0)
    try:
        tty.setraw(0)
        while True:
            readable, _, _ = select.select([connection, 0], [], [])
            for source in readable:
                part = connection.recv(8192) if source == connection else os.read(0, 8192)
                if not part:
                    sys.exit(0)
                if source == connection:
                    os.write(1, part)
                else:
                    connection.sendall(part)
    finally:
        termios.tcsetattr(0, termios.TCSANOW, old)
else:
    print(json.dumps(response))
    sys.exit(0 if response.get('code', 0) == 0 else 1)
