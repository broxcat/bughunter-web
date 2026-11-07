#!/usr/bin/python3
"""Trusted root launcher. No TCP listener, shell evaluation or caller paths.
Only the dedicated admission-service UID can connect. Console UIDs cannot.
Registry and runtime state must be dedicated durable volumes, owned by root.
"""
import fcntl
import contextlib
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
RUNNING = {}

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
    if not __import__('stat').S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_gid != 0 or st.st_mode & 0o022:
        fail('UNSAFE_REGISTRY')
    os.chmod(path,mode)


@contextlib.contextmanager
def metadata_lock(name):
    if not re.fullmatch(r'[a-z0-9-]{1,40}',name):fail('INVALID_LOCK')
    fd=os.open(ROOT+'/'+name+'.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        st=os.fstat(fd)
        if not __import__('stat').S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or st.st_nlink!=1 or st.st_mode&0o022 or st.st_size!=0:fail('UNSAFE_LOCK')
        os.fchmod(fd,0o600)
        fcntl.flock(fd,fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def reject_revoked(uid):
    path=binding_path(uid)
    try:fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    except FileNotFoundError:return
    with os.fdopen(fd) as file:
        st=os.fstat(file.fileno())
        if st.st_uid!=0 or st.st_gid!=uid or st.st_nlink!=1 or st.st_size>4096:fail('UNSAFE_REGISTRY')
        if json.load(file).get('state')!='active':fail('IDENTITY_REVOKED')


def atomic(path, value, gid=0, mode=0o600):
    temporary = path + '.tmp'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        remaining=memoryview(json.dumps(value,sort_keys=True).encode())
        while remaining:
            written=os.write(fd,remaining)
            if written<=0:raise OSError('METADATA_WRITE_FAILED')
            remaining=remaining[written:]
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
        if os.path.lexists(HOMES+'/.allocated') or os.listdir(HOMES) or os.listdir(ROOT+'/active') or any(FIRST<=item.stat(follow_symlinks=False).st_gid<=LAST for item in os.scandir('/workspaces')):
            fail('REGISTRY_LOST_OPERATOR_REVIEW_REQUIRED')
        return {'version': 1, 'next': FIRST, 'targets': {}, 'retired': []}
    with os.fdopen(fd) as file:
        st = os.fstat(file.fileno())
        if st.st_uid != 0 or st.st_mode & 0o077 or st.st_nlink != 1 or st.st_size > 32 * 1024 * 1024:
            fail('UNSAFE_REGISTRY')
        data = json.load(file)
    for target,entry in data['targets'].items():
        if entry.get('targetId')!=target or entry.get('workspaceId')!='research_'+target or not IDENTITY.fullmatch(target) or entry.get('uid')!=entry.get('gid'):
            fail('INVALID_REGISTRY')
    ids = [entry['uid'] for entry in [*data['targets'].values(),*data.get('retired',[])]]
    if data['version'] != 1 or len(ids) != len(set(ids)) or any(uid < FIRST or uid > LAST for uid in ids) or data['next'] <= max(ids, default=FIRST-1):
        fail('INVALID_REGISTRY')
    return data


def allocate(binding):
    # Cross-process flock plus in-process mutex; retain all records/tombstones.
    with LOCK, metadata_lock('allocation'):
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
        if not os.path.lexists(HOMES+'/.allocated'):
            atomic(HOMES+'/.allocated',{'version':1})
        return entry


def ensure_account(entry):
    uid = entry['uid']
    name = 'research-' + str(uid)
    home = HOMES + '/' + str(uid) + '/home'
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


def binding_path(uid):
    directory=ROOT+'/active/'+str(uid)
    try:
        os.mkdir(directory,0o750)
        os.chown(directory,0,uid)
    except FileExistsError:
        pass
    st=os.lstat(directory)
    if not __import__('stat').S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_gid!=uid or (st.st_mode&0o7777)!=0o750:
        fail('UNSAFE_REGISTRY')
    return directory+'/binding.json'


def lookup(target):
    if not isinstance(target, str) or not IDENTITY.fullmatch(target):
        fail('INVALID_TARGET')
    with LOCK:
        entry = ledger()['targets'].get(target)
    if not entry:
        fail('MIGRATION_REQUIRED')
    ensure_account(entry)
    path = binding_path(entry['uid'])
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as file:
        st=os.fstat(file.fileno())
        if st.st_uid!=0 or st.st_gid!=entry['gid'] or (st.st_mode&0o7777)!=0o440 or st.st_nlink!=1 or st.st_size>4096:
            fail('UNSAFE_REGISTRY')
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
    home = HOMES + '/' + str(entry['uid']) + '/home'
    cwd = '/workspaces/' + entry['workspaceId']
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': home, 'USER': 'research-' + str(entry['uid']), 'LOGNAME': 'research-' + str(entry['uid']), 'TERM': 'xterm-256color', 'LANG': 'C.UTF-8', 'CODEX_HOME': home + '/.codex', 'CLAUDE_CONFIG_DIR': home + '/.claude', 'DISABLE_AUTOUPDATER': '1', 'PLAYWRIGHT_BROWSERS_PATH': '/ms-playwright', 'TMUX_TMPDIR': home + '/run', 'TMPDIR': home + '/tmp'}
    if provider not in PROFILES or profile not in PROFILES[provider]:
        fail('INVALID_PROFILE')
    name = ('bughunter-' if provider=='codex' else 'bughunter_claude_') + entry['targetId']
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
        'mcp-reconnect': ['node','/opt/bughunter/docker/research/broker/probe.mjs',provider,'reconnect'],
    }
    if operation not in commands:
        fail('INVALID_OPERATION')
    # setpriv closes the privilege transition before any provider/tmux code.
    return ['setpriv', '--reuid=' + str(entry['uid']), '--regid=' + str(entry['gid']), '--clear-groups', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '--', *commands[operation]], cwd, env


def run(entry, operation, provider, profile, payload=None):
    # Serialize admission and process creation, not long native MCP probes.
    # Track the launcher's pidfd before releasing the lock: revocation must kill
    # it even if setpriv has not yet changed its credentials.
    uid=entry['uid']
    with identity_lock(uid):
        current=lookup(entry['targetId'])
        if current!=entry:fail('IDENTITY_CHANGED')
        args,cwd,env=command(current,operation,provider,profile)
        child=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.PIPE if payload else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,start_new_session=True)
        descriptor=os.pidfd_open(child.pid)
        RUNNING.setdefault(uid,set()).add(descriptor)
    try:
        try:
            stdout,_=child.communicate(payload.encode() if payload else None,timeout=25)
        except subprocess.TimeoutExpired:
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            child.communicate()
            fail('NATIVE_CHECK_TIMEOUT')
        with identity_lock(uid):
            if lookup(entry['targetId'])!=entry:fail('IDENTITY_CHANGED')
        return {'code':child.returncode,'stdout':stdout[:65536].decode(errors='replace') if operation in ['help','version','profile','probe','mcp','mcp-reconnect','recon'] else ''}
    finally:
        with identity_lock(uid):
            RUNNING.get(uid,set()).discard(descriptor)
            os.close(descriptor)


def revoke_locked(token):
    claims = admitted(token, stop=True)
    with LOCK:
        entry = ledger()['targets'].get(claims['targetId'])
        if not entry or entry['workspaceId'] != claims['workspaceId']:
            fail('IDENTITY_CHANGED')
        with metadata_lock('lifecycle-'+str(entry['uid'])):
            atomic(binding_path(entry['uid']), {**entry, 'state':'revoked'}, entry['gid'], 0o440)
    # Stop tracked launchers before scanning their dedicated-UID descendants.
    for descriptor in RUNNING.get(entry['uid'],set()):
        try:signal.pidfd_send_signal(descriptor,signal.SIGKILL)
        except ProcessLookupError:pass
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
            with LOCK, metadata_lock('allocation'):
                data=ledger()
                data['targets'][claims['targetId']]['state']='deleted'
                atomic(ROOT+'/ledger.json',data)
        return result


def installation_status(provider):
    if provider not in PROFILES:fail('INVALID_PROVIDER')
    home='/var/empty/bughunter-probe'
    env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':home,'CODEX_HOME':home+'/.codex','CLAUDE_CONFIG_DIR':home+'/.claude','DISABLE_AUTOUPDATER':'1'}
    prefix=['setpriv','--reuid=199999','--regid=199999','--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',provider]
    version=subprocess.run(prefix+['--version'],cwd=home,env=env,capture_output=True,text=True,timeout=5,close_fds=True)
    help_result=subprocess.run(prefix+['--help'],cwd=home,env=env,capture_output=True,text=True,timeout=5,close_fds=True)
    if version.returncode or help_result.returncode:fail('CLI_UNAVAILABLE')
    found=re.search(r'\b\d+\.\d+\.\d+\b',version.stdout)
    help_text=help_result.stdout
    profiles=([*(['standard'] if '--ask-for-approval' in help_text and '--sandbox' in help_text else []),*(['yolo'] if '--dangerously-bypass-approvals-and-sandbox' in help_text else [])] if provider=='codex' else (['standard','plan'] if '--permission-mode' in help_text and '"manual"' in help_text and '"plan"' in help_text else []))
    return {'provider':provider,'installation':'available','authentication':'required','version':found[0] if found else None,'code':None,'profiles':profiles,'runningProfile':None}


def inspect_engine(target,provider,profile):
    if not isinstance(target,str) or not IDENTITY.fullmatch(target):fail('INVALID_TARGET')
    entry=ledger()['targets'].get(target)
    if not entry or entry.get('state')=='deleted':return installation_status(provider)
    entry=lookup(target)
    status=json.loads(run(entry,'probe',provider,profile)['stdout'])
    available=installation_status(provider)
    running=run(entry,'profile',provider,profile)
    return {**status,'profiles':available['profiles'],'runningProfile':running['stdout'].strip().removeprefix('BUGHUNTER_LAUNCH_PROFILE=') if running['code']==0 else None}


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
            response=run(entry,'recon',claims['provider'],'standard' if claims['provider']=='claude' else 'yolo',request['token'])
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
            verify_workspace_root()
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
            if operation=='inspect':
                connection.sendall(json.dumps({'code':0,'stdout':json.dumps(inspect_engine(request['targetId'],request['provider'],request['profile']))}).encode()+b'\n')
                return
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
                    launcher_descriptor=os.pidfd_open(pid)
                    RUNNING.setdefault(entry['uid'],set()).add(launcher_descriptor)
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
                    with identity_lock(entry['uid']):
                        RUNNING.get(entry['uid'],set()).discard(launcher_descriptor)
                        os.close(launcher_descriptor)
                return
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


def verify_workspace_root():
    # A private A cannot coexist with a world-readable, unmigrated B. Refuse
    # serving unknown/unsafe roots instead of silently chmod/chowning them.
    import stat
    parent=os.lstat('/workspaces')
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid not in {0,SERVICE_UID} or parent.st_gid not in {0,SERVICE_GID,2000} or parent.st_mode&0o002:
        fail('UNSAFE_WORKSPACE_ROOT')
    known=ledger()['targets']
    for count,item in enumerate(os.scandir('/workspaces')):
        if count>=200000:fail('WORKSPACE_INVENTORY_LIMIT')
        st=item.stat(follow_symlinks=False)
        if stat.S_ISLNK(st.st_mode) or st.st_mode&0o007 or st.st_uid not in {0,SERVICE_UID}:
            fail('OPERATOR_REVIEW_REQUIRED')
        if FIRST<=st.st_gid<=LAST:
            target=item.name.removeprefix('research_')
            if not item.name.startswith('research_') or target not in known or known[target]['gid']!=st.st_gid or (st.st_mode&0o7777)!=0o750 or st.st_uid!=0:
                fail('OPERATOR_REVIEW_REQUIRED')
        elif st.st_gid not in {0,SERVICE_GID,2000}:
            fail('OPERATOR_REVIEW_REQUIRED')


def serve():
    if os.getuid() != 0:
        fail('ROOT_BROKER_REQUIRED')
    probe_descriptor=os.pidfd_open(os.getpid())
    os.close(probe_descriptor)
    for path in [ROOT, ROOT + '/active', HOMES, '/run/bughunter-broker']:
        secure_dir(path)
    # Refuse stale/unexpected socket rather than unlink arbitrary content.
    if os.path.lexists(SOCKET):
        st = os.lstat(SOCKET)
        if not __import__('stat').S_ISSOCK(st.st_mode) or st.st_uid != SERVICE_UID:
            fail('UNSAFE_SOCKET')
        os.unlink(SOCKET)
    verify_workspace_root()
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
