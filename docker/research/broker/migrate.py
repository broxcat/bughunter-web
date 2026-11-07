#!/usr/bin/python3
"""Explicit offline reconciliation. stdin is a short-lived server-issued ticket.
No production invocation is part of tests. Unknown provider history fails closed.
"""
import hashlib
import json
import os
import stat
import sys
from broker import ROOT, HOMES, SERVICE_UID, SERVICE_GID, secure_dir, admitted, allocate, atomic, fail

MAX_ENTRIES, MAX_BYTES = 10000, 256 * 1024 * 1024


def inventory(path, allocated=None):
    handles, metadata, total = [], [], 0
    def visit(parent, name, relative):
        nonlocal total
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        handles.append(fd)
        st = os.fstat(fd)
        if len(handles) > MAX_ENTRIES or st.st_uid not in {0, SERVICE_UID, allocated} or st.st_gid not in {0, SERVICE_UID, SERVICE_GID, 2000, allocated} or st.st_mode & 0o002:
            fail('OPERATOR_REVIEW_REQUIRED')
        if stat.S_ISDIR(st.st_mode):
            metadata.append((fd, relative, True, None))
            for child in sorted(os.listdir(fd)):
                visit(fd, child, relative + '/' + child if relative else child)
        elif stat.S_ISREG(st.st_mode) and st.st_nlink == 1:
            total += st.st_size
            if total > MAX_BYTES:
                fail('OPERATOR_REVIEW_REQUIRED')
            digest = hashlib.sha256()
            while True:
                part = os.read(fd, 65536)
                if not part:
                    break
                digest.update(part)
            metadata.append((fd, relative, False, digest.hexdigest()))
        else:
            fail('OPERATOR_REVIEW_REQUIRED')
    try:
        visit(None, path, '')
        return handles, metadata
    except Exception:
        for fd in handles:
            os.close(fd)
        raise


def legacy_active(expected_uid=SERVICE_UID):
    for pid in os.listdir('/proc'):
        if not pid.isdecimal():
            continue
        try:
            status = open('/proc/' + pid + '/status').read()
            uid = int(next(line.split()[1] for line in status.splitlines() if line.startswith('Uid:')))
            if uid == expected_uid:
                return True
        except (OSError, StopIteration):
            pass
    return False


def migrate(token, apply=False, fresh=False):
    if os.getuid() != 0:
        fail('ROOT_OPERATOR_REQUIRED')
    for path in [ROOT, ROOT + '/active', HOMES]:
        secure_dir(path)
    binding = admitted(token)
    if not fresh and legacy_active():
        fail('LEGACY_SESSION_ACTIVE')
    from broker import metadata_lock,reject_revoked,lookup
    lock=metadata_lock('migration')
    lock.__enter__()
    handles = []
    export = None
    try:
        from broker import ledger
        previous = ledger()['targets'].get(binding['targetId'])
        already_active=False
        if previous and previous.get('state')!='deleted':
            reject_revoked(previous['uid'])
            try:lookup(binding['targetId']);already_active=True
            except FileNotFoundError:pass
        if previous and legacy_active(previous['uid']):
            fail('WORKSPACE_SESSION_ACTIVE')
        from provider_export import load_export, import_export
        export=load_export(binding,inventory)
        if not fresh and previous is None and export is None:
            fail('OPERATOR_REVIEW_REQUIRED')
        for path in ['/home/researcher/.codex/sessions','/home/researcher/.codex/state_5.sqlite','/home/researcher/.claude/workspaces/'+binding['targetId']]:
            if not fresh and os.path.lexists(path) and export is None:
                fail('OPERATOR_REVIEW_REQUIRED')

        handles, entries = inventory('/workspaces/' + binding['workspaceId'], previous['uid'] if previous else None)
        names = {relative for _, relative, _, _ in entries}
        if not {'scope.md','.agents/bughunter/AGENTS.md','.agents/bughunter/policy.json','.agents/bughunter/target.json','.agents/bughunter/session.json'}.issubset(names):
            fail('OPERATOR_REVIEW_REQUIRED')
        before = {name: digest for _, name, directory, digest in entries if not directory}
        if not apply:
            return {'status': 'DRY_RUN', 'targetId': binding['targetId'], 'entries': len(entries), 'files': len(before)}
        entry = allocate(binding)
        from broker import ensure_account,binding_path
        ensure_account(entry)
        parent_stat=os.lstat('/workspaces')
        if not stat.S_ISDIR(parent_stat.st_mode) or parent_stat.st_uid not in {0,SERVICE_UID}:
            fail('OPERATOR_REVIEW_REQUIRED')
        os.chmod('/workspaces',0o711)
        uid = entry['uid']
        outer=HOMES+'/'+str(uid)
        try:
            os.mkdir(outer,0o750)
            os.chown(outer,0,uid)
        except FileExistsError:
            st=os.lstat(outer)
            if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_gid!=uid or (st.st_mode&0o7777)!=0o750:
                fail('OPERATOR_REVIEW_REQUIRED')
        home = outer+'/home'
        try:
            os.mkdir(home, 0o700)
            os.chown(home, uid, uid)
        except FileExistsError:
            st = os.lstat(home)
            if not stat.S_ISDIR(st.st_mode) or st.st_uid != uid or st.st_gid != uid or st.st_mode & 0o077:
                fail('OPERATOR_REVIEW_REQUIRED')
        for name in ['.codex','.claude','run','tmp']:
            path = home + '/' + name
            try:
                os.mkdir(path, 0o700)
                os.chown(path, uid, uid)
            except FileExistsError:
                st = os.lstat(path)
                if not stat.S_ISDIR(st.st_mode) or st.st_uid != uid or st.st_gid != uid or st.st_mode & 0o077:
                    fail('OPERATOR_REVIEW_REQUIRED')
        # Every descriptor was opened without following links before mutation.
        for fd, relative, directory, digest in entries:
            writable = relative.split('/')[0] in ['requests','scripts','findings']
            os.fchmod(fd, (0o700 if writable else 0o750) if directory else (0o600 if writable else 0o440))
            os.fchown(fd, uid if writable else 0, uid)
            if not directory:
                os.lseek(fd, 0, os.SEEK_SET)
                after = hashlib.sha256()
                while True:
                    part = os.read(fd, 65536)
                    if not part:
                        break
                    after.update(part)
                if after.hexdigest() != digest:
                    fail('CONTENT_CHANGED')
        transcripts=0 if already_active else import_export(export,home,uid)
        with metadata_lock('lifecycle-'+str(uid)):
            reject_revoked(uid)
            atomic('/workspaces/'+binding['workspaceId']+'/.agents/bughunter/isolation.json',{**entry,'state':'active'},uid,0o440)
            atomic(binding_path(uid), {**entry, 'state': 'active'}, uid, 0o440)
        return {'status': 'MIGRATED', 'targetId': binding['targetId'], 'filesPreserved': len(before), 'providerFilesPreserved':transcripts}
    finally:
        for fd in handles:
            os.close(fd)
        if export is not None:
            for fd in export[0]:
                os.close(fd)
        lock.__exit__(None,None,None)

if __name__ == '__main__':
    try:
        if sys.argv[1:] not in [[], ['--apply']]:
            fail('INVALID_ARGUMENT')
        print(json.dumps(migrate(sys.stdin.read(4096), sys.argv[1:] == ['--apply'])))
    except Exception as error:
        import re
        code=str(error) if type(error) is ValueError and re.fullmatch(r'[A-Z_]{3,80}',str(error)) else 'OPERATOR_REVIEW_REQUIRED'
        print(json.dumps({'status':code}))
        sys.exit(1)
