#!/usr/bin/python3
"""Trusted root launcher. No TCP listener, shell evaluation or caller paths.
Only the dedicated admission-service UID can connect. Console UIDs cannot.
Registry and runtime state must be dedicated durable volumes, owned by root.
"""
import fcntl
import json
import os
import pwd
import grp
import re
import resource
import signal
import socket
import struct
import subprocess
import sys
import threading
import time

ROOT = '/var/lib/bughunter-identities'
HOMES = '/var/lib/bughunter-homes'
SOCKET = '/run/bughunter-broker/control.sock'
FIRST, LAST = 200001, 299999
SERVICE_UID = pwd.getpwnam('researcher').pw_uid
SERVICE_GID = pwd.getpwnam('researcher').pw_gid
IDENTITY = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')
PROFILES = {'codex': ['standard', 'yolo'], 'claude': ['standard', 'plan']}
LOCK = threading.RLock()
LIFECYCLE = {}
RECON_SPENT = {}
ATTACHMENTS = {}

def identity_lock(uid):
    with LOCK:
        return LIFECYCLE.setdefault(uid, threading.RLock())


def fail(code='ISOLATION_UNAVAILABLE'):
    raise ValueError(code)


def secure_dir(path, mode=0o711):
    try:
        os.mkdir(path, mode)
    except FileExistsError:
        pass
    st = os.lstat(path)
    if not __import__('stat').S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
        fail('UNSAFE_REGISTRY')


def atomic(path, value, gid=0, mode=0o600):
    temporary = path + '.tmp'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, json.dumps(value, sort_keys=True).encode())
        os.fchown(fd, 0, gid)
        os.fchmod(fd, mode)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temporary, path)
    directory = os.open(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def ledger():
    path = ROOT + '/ledger.json'
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return {'version': 1, 'next': FIRST, 'targets': {}, 'retired': []}
    with os.fdopen(fd) as file:
        st = os.fstat(file.fileno())
        if st.st_uid != 0 or st.st_mode & 0o077 or st.st_nlink != 1 or st.st_size > 32 * 1024 * 1024:
            fail('UNSAFE_REGISTRY')
        data = json.load(file)
    ids = [entry['uid'] for entry in [*data['targets'].values(),*data.get('retired',[])]]
    if data['version'] != 1 or len(ids) != len(set(ids)) or any(uid < FIRST or uid > LAST for uid in ids) or data['next'] <= max(ids, default=FIRST-1):
        fail('INVALID_REGISTRY')
    return data


def allocate(binding):
    # Cross-process flock plus in-process mutex; retain all records/tombstones.
    with LOCK, open(ROOT + '/allocation.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = ledger()
        old = data['targets'].get(binding['targetId'])
        if old:
            if old.get('state')=='deleted' and any(old[k] != binding[k] for k in binding):
                data.setdefault('retired',[]).append(old)
            else:
                if any(old[k] != binding[k] for k in binding):
                    fail('IDENTITY_CHANGED')
                return old
        uid = data['next']
        if uid > LAST:
            fail('IDENTITY_RANGE_EXHAUSTED')
        if os.path.lexists(HOMES + '/' + str(uid)) or any(item.stat(follow_symlinks=False).st_gid == uid for item in os.scandir('/workspaces')):
            fail('RESIDUAL_IDENTITY_COLLISION')
        try:
            grp.getgrgid(uid)
            fail('IDENTITY_COLLISION')
        except KeyError:
            pass
        try:
            pwd.getpwuid(uid)
            fail('IDENTITY_COLLISION')
        except KeyError:
            pass
        entry = {**binding, 'uid': uid, 'gid': uid, 'v': 1, 'state': 'pending'}
        data['targets'][binding['targetId']] = entry
        data['next'] = uid + 1
        atomic(ROOT + '/ledger.json', data)
        return entry


def ensure_account(entry):
    uid = entry['uid']
    name = 'research-' + str(uid)
    home = HOMES + '/' + str(uid)
    try:
        group = grp.getgrgid(uid)
        if group.gr_name != name:
            fail('IDENTITY_COLLISION')
    except KeyError:
        subprocess.run(['groupadd','--gid',str(uid),name],check=True,capture_output=True)
    try:
        account = pwd.getpwuid(uid)
        if account.pw_name != name or account.pw_gid != uid or account.pw_dir != home:
            fail('IDENTITY_COLLISION')
    except KeyError:
        subprocess.run(['useradd','--no-create-home','--uid',str(uid),'--gid',str(uid),'--home-dir',home,'--shell','/bin/bash',name],check=True,capture_output=True)


def provision_fresh(token, binding):
    # Only new publications from trusted web code carry this immutable marker.
    # Legacy workspaces require the explicit offline operator migration command.
    path = '/workspaces/' + binding['workspaceId'] + '/.agents/bughunter/isolation-new.json'
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd) as file:
        st = os.fstat(file.fileno())
        if st.st_uid != 0 or st.st_mode & 0o222 or st.st_nlink != 1 or st.st_size > 4096:
            fail('MIGRATION_REQUIRED')
        marker = json.load(file)
    if marker != {'version':1,'targetId':binding['targetId'],'workspaceId':binding['workspaceId'],'sessionId':binding['sessionId']}:
        fail('MIGRATION_REQUIRED')
    from migrate import migrate
    migrate(token, apply=True, fresh=True)


def lookup(target):
    if not isinstance(target, str) or not IDENTITY.fullmatch(target):
        fail('INVALID_TARGET')
    with LOCK:
        entry = ledger()['targets'].get(target)
    if not entry:
        fail('MIGRATION_REQUIRED')
    ensure_account(entry)
    path = ROOT + '/active/' + str(entry['uid']) + '.json'
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as file:
        active = json.load(file)
    if active.get('state') != 'active' or any(active[k] != entry[k] for k in ['uid','gid','targetId','workspaceId','sessionId','policySha256']):
        fail('IDENTITY_REVOKED')
    return active


def admitted(token, stop=False, recon=False):
    if not isinstance(token, str) or len(token) > 2048:
        fail('INVALID_TICKET')
    result = subprocess.run(['node', '/opt/bughunter/docker/research/broker/admit.mjs', *(['recon'] if recon else ['stop'] if stop else [])], input=token, text=True, capture_output=True, timeout=5, env={'PATH': '/usr/local/bin:/usr/bin:/bin'})
    if result.returncode:
        fail('INVALID_TICKET')
    return json.loads(result.stdout)


def command(entry, operation, provider=None, profile=None):
    home = HOMES + '/' + str(entry['uid'])
    cwd = '/workspaces/' + entry['workspaceId']
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': home, 'USER': 'research-' + str(entry['uid']), 'LOGNAME': 'research-' + str(entry['uid']), 'TERM': 'xterm-256color', 'LANG': 'C.UTF-8', 'CODEX_HOME': home + '/.codex', 'CLAUDE_CONFIG_DIR': home + '/.claude', 'DISABLE_AUTOUPDATER': '1', 'PLAYWRIGHT_BROWSERS_PATH': '/ms-playwright', 'TMUX_TMPDIR': home + '/run', 'TMPDIR': home + '/tmp'}
    if provider not in PROFILES or profile not in PROFILES[provider]:
        fail('INVALID_PROFILE')
    name = 'bughunter_' + provider + '_' + entry['targetId']
    tmux = ['tmux', '-S', home + '/run/tmux.sock']
    commands = {
        'start': tmux + ['-f', '/etc/bughunter/tmux.conf', 'new-session', '-d', '-s', name, '-c', cwd, '-e', 'BUGHUNTER_LAUNCH_PROFILE=' + profile, '/usr/local/bin/bughunter-' + provider, '--bughunter-profile', profile],
        'attach': tmux + ['attach-session', '-t', '=' + name],
        'exists': tmux + ['has-session', '-t', '=' + name],
        'version': [provider, '--version'],
        'help': [provider, '--help'],
        'profile': tmux + ['show-environment', '-t', '=' + name, 'BUGHUNTER_LAUNCH_PROFILE'],
        'probe': ['node','/opt/bughunter/docker/research/broker/probe.mjs',provider,'probe'],
        'recon': ['node','/opt/bughunter/docker/research/broker/recon.mjs'],
        'mcp': ['node','/opt/bughunter/docker/research/broker/probe.mjs',provider,'mcp'],
    }
    if operation not in commands:
        fail('INVALID_OPERATION')
    # setpriv closes the privilege transition before any provider/tmux code.
    return ['setpriv', '--reuid=' + str(entry['uid']), '--regid=' + str(entry['gid']), '--clear-groups', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '--', *commands[operation]], cwd, env


def run(entry, operation, provider, profile, payload=None):
    args, cwd, env = command(entry, operation, provider, profile)
    result = subprocess.run(args, cwd=cwd, env=env, input=payload.encode() if payload else None, capture_output=True, timeout=25, close_fds=True)
    # Help/version only contain installation metadata. Never return transcripts.
    return {'code': result.returncode, 'stdout': result.stdout[:65536].decode(errors='replace') if operation in ['help','version','profile','probe','mcp','recon'] else ''}


def revoke_locked(token):
    claims = admitted(token, stop=True)
    with LOCK:
        entry = ledger()['targets'].get(claims['targetId'])
        if not entry or entry['workspaceId'] != claims['workspaceId']:
            fail('IDENTITY_CHANGED')
        atomic(ROOT + '/active/' + str(entry['uid']) + '.json', {**entry, 'state':'revoked'}, entry['gid'], 0o440)
    # Re-scan descendants while admission is locked; pidfds prevent PID reuse.
    deadline=time.monotonic()+2
    while True:
        active=False
        for name in os.listdir('/proc'):
            if not name.isdecimal():
                continue
            fd = None
            try:
                fd = os.pidfd_open(int(name))
                with open('/proc/' + name + '/status') as status_file:
                    status = status_file.read()
                uid = int(next(line.split()[1] for line in status.splitlines() if line.startswith('Uid:')))
                if uid == entry['uid'] and not re.search(r'^State:\s+Z',status,re.M):
                    active=True
                    signal.pidfd_send_signal(fd, signal.SIGKILL)
            except (OSError, StopIteration):
                pass
            finally:
                if fd is not None:
                    os.close(fd)
        if not active:
            break
        if time.monotonic()>deadline:
            fail('CLEANUP_UNCONFIRMED')
        time.sleep(0.05)
    return {'stopped':True}


def revoke(token, delete=False):
    claims=admitted(token,stop=True)
    with LOCK:
        entry=ledger()['targets'].get(claims['targetId'])
    if not entry:
        fail('IDENTITY_CHANGED')
    with identity_lock(entry['uid']):
        result=revoke_locked(token)
        if delete:
            from cleanup import remove_home,retain_reviewed_export
            remove_home(entry)
            retain_reviewed_export(entry)
            with LOCK, open(ROOT+'/allocation.lock','a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX)
                data=ledger()
                data['targets'][claims['targetId']]['state']='deleted'
                atomic(ROOT+'/ledger.json',data)
        return result


def handle(connection):
    try:
        _, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != SERVICE_UID:
            fail('BROKER_PEER_DENIED')
        data = bytearray()
        while len(data) < 4096:
            part = connection.recv(1)
            if not part or part == b'\n':
                break
            data.extend(part)
        request = json.loads(data)
        operation = request.get('operation')
        allowed = {'operation','targetId','provider','profile'}
        if operation == 'recon':
            if set(request) != {'operation','token'}:
                fail('INVALID_REQUEST')
            claims=admitted(request['token'],recon=True)
            with LOCK:
                for key,expiry in list(RECON_SPENT.items()):
                    if expiry<time.time(): del RECON_SPENT[key]
                if claims['deliveryId'] in RECON_SPENT or len(RECON_SPENT)>=10000: fail('REPLAY')
                RECON_SPENT[claims['deliveryId']]=claims['exp']
            entry=lookup(claims['targetId'])
            with identity_lock(entry['uid']):
                response=run(lookup(claims['targetId']),'recon',claims['provider'],'standard' if claims['provider']=='claude' else 'yolo',request['token'])
        elif operation == 'resize':
            if set(request)!={'operation','targetId','provider','profile','cols','rows'} or any(type(request[k]) is not int or not 2<=request[k]<=500 for k in ['cols','rows']): fail('INVALID_REQUEST')
            entry=lookup(request['targetId'])
            command(entry,'attach',request['provider'],request['profile'])
            with identity_lock(entry['uid']):
                import termios
                for fd in ATTACHMENTS.get((entry['uid'],request['provider']),set()):
                    fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',request['rows'],request['cols'],0,0))
            response={'resized':True}
        elif operation in ['revoke','delete']:
            if set(request) != {'operation','token'}:
                fail('INVALID_REQUEST')
            response = revoke(request['token'],delete=operation=='delete')
        elif operation == 'admit':
            if set(request) != {'operation','token'}:
                fail('INVALID_REQUEST')
            binding = admitted(request['token'])
            with LOCK:
                if binding['targetId'] not in ledger()['targets'] or ledger()['targets'][binding['targetId']].get('state')=='deleted':
                    provision_fresh(request['token'], binding)
                entry = lookup(binding['targetId'])
            if any(entry[k] != binding[k] for k in binding):
                fail('IDENTITY_CHANGED')
            response = {'ready': True}
        else:
            if set(request) != allowed:
                fail('INVALID_REQUEST')
            entry = lookup(request['targetId'])
            if operation == 'attach':
                # Dedicated PTY and no inherited workspace descriptors. Only
                # terminal bytes cross this connection after successful lookup.
                import pty
                with identity_lock(entry['uid']):
                    entry = lookup(request['targetId'])
                    args, cwd, env = command(entry, operation, request['provider'], request['profile'])
                    pid, fd = pty.fork()
                    if pid == 0:
                        try:
                            os.chdir(cwd)
                            os.closerange(3, min(resource.getrlimit(resource.RLIMIT_NOFILE)[0], 1048576))
                            os.execve('/usr/bin/setpriv', args, env)
                        finally:
                            os._exit(127)
                import termios
                import select
                try:
                    with identity_lock(entry['uid']):
                        fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',32,120,0,0))
                        ATTACHMENTS.setdefault((entry['uid'],request['provider']),set()).add(fd)
                    connection.sendall(b'{"stream":true}\n')
                    while True:
                        readable, _, _ = select.select([connection, fd], [], [], 30)
                        if not readable:
                            continue
                        if connection in readable:
                            part = connection.recv(8192)
                            if not part:
                                break
                            os.write(fd, part)
                        if fd in readable:
                            try:
                                part = os.read(fd, 8192)
                            except OSError:
                                break
                            if not part:
                                break
                            connection.sendall(part)
                finally:
                    with identity_lock(entry['uid']):
                        ATTACHMENTS.get((entry['uid'],request['provider']),set()).discard(fd)
                        os.close(fd)
                    try:
                        os.kill(pid, signal.SIGHUP)
                    except ProcessLookupError:
                        pass
                    if os.waitpid(pid,os.WNOHANG)[0]==0:
                        try:os.kill(pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        os.waitpid(pid,0)
                return
            with identity_lock(entry['uid']):
                entry = lookup(request['targetId'])
                response = run(entry, operation, request['provider'], request['profile'])
        connection.sendall(json.dumps(response).encode() + b'\n')
    except Exception:
        # Safe code only; never paths, tickets, command output or note contents.
        try:
            connection.sendall(b'{"error":"ISOLATION_UNAVAILABLE"}\n')
        except OSError:
            pass
    finally:
        connection.close()


def serve():
    if os.getuid() != 0:
        fail('ROOT_BROKER_REQUIRED')
    for path in [ROOT, ROOT + '/active', HOMES, '/run/bughunter-broker']:
        secure_dir(path)
    # Refuse stale/unexpected socket rather than unlink arbitrary content.
    if os.path.lexists(SOCKET):
        st = os.lstat(SOCKET)
        if not __import__('stat').S_ISSOCK(st.st_mode) or st.st_uid != SERVICE_UID:
            fail('UNSAFE_SOCKET')
        os.unlink(SOCKET)
    for entry in ledger()['targets'].values():
        ensure_account(entry)
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(SOCKET)
    os.chown(SOCKET, SERVICE_UID, SERVICE_UID)
    os.chmod(SOCKET, 0o600)
    listener.listen(16)
    slots = threading.BoundedSemaphore(32)
    def worker(connection):
        try:
            handle(connection)
        finally:
            slots.release()
    while True:
        connection, _ = listener.accept()
        if not slots.acquire(blocking=False):
            connection.close()
            continue
        threading.Thread(target=worker, args=(connection,), daemon=True).start()

if __name__ == '__main__':
    serve()
