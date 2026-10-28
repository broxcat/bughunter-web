"""Disposable PTY input recorder; no shell, network, or model invocation."""
import codecs
import json
import os
import signal
import sys
import termios

with open(sys.argv[1], 'w', encoding='utf-8') as receipt:
    def record(value):
        receipt.write(json.dumps(value) + '\n')
        receipt.flush()

    def interrupted(_signal, _frame):
        record({'signal': 'SIGINT'})

    attrs = termios.tcgetattr(0)
    # Record xterm's exact bytes, without the PTY translating CR into LF.
    attrs[0] &= ~(termios.ICRNL | termios.INLCR | termios.IGNCR)
    attrs[3] |= termios.ISIG
    attrs[3] &= ~(termios.ECHO | termios.ICANON)
    attrs[6][termios.VINTR] = b'\x03'
    termios.tcsetattr(0, termios.TCSANOW, attrs)
    signal.signal(signal.SIGINT, interrupted)
    os.write(1, b'\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[2J\x1b[H\x1b[?2004hConsoleClipboardFixture\r\n')
    decoder = codecs.getincrementaldecoder('utf-8')()
    while True:
        data = os.read(0, 8192)
        if not data:
            break
        record({'input': decoder.decode(data)})
