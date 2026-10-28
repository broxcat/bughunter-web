"""Expose loopback Burp listeners only on the private Compose network interface.

DNS is resolved at startup; no container IP is persisted. Neither port is published.
"""
import asyncio
import socket


async def forward(reader, writer, port):
    upstream = None
    try:
        remote, upstream = await asyncio.wait_for(asyncio.open_connection('127.0.0.1', port), 3)

        async def copy(source, destination):
            while data := await source.read(65536):
                destination.write(data)
                await destination.drain()
            if destination.can_write_eof():
                destination.write_eof()

        await asyncio.gather(copy(reader, upstream), copy(remote, writer))
    except (OSError, TimeoutError):
        pass
    finally:
        writer.close()
        if upstream:
            upstream.close()


async def main():
    # This alias exists only on burp_link, never on the egress network.
    host = socket.gethostbyname('burp-private')
    servers = [await asyncio.start_server(lambda r, w: forward(r, w, 9876), host, 9877),
               await asyncio.start_server(lambda r, w: forward(r, w, 8080), host, 8081)]
    await asyncio.gather(*(server.serve_forever() for server in servers))


asyncio.run(main())
