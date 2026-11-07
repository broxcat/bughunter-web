"""Import an explicitly reviewed, root-protected per-workspace export.
Never partition a shared provider database automatically or copy credentials.
Original legacy volumes remain untouched for retention/rollback.
"""
import hashlib
import json
import os
import sqlite3
import stat
from broker import ROOT, fail


def load_export(binding, inventory):
    path = ROOT + '/exports/' + binding['targetId']
    if not os.path.lexists(path):
        return None
    # Protect all export ancestors: a legacy researcher must not swap content.
    for directory in [ROOT, ROOT + '/exports', path]:
        st = os.lstat(directory)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
            fail('OPERATOR_REVIEW_REQUIRED')
    handles, entries = inventory(path)
    try:
        manifest_fd = next(fd for fd,name,directory,_ in entries if name == 'manifest.json' and not directory)
        st = os.fstat(manifest_fd)
        if st.st_uid != 0 or st.st_mode & 0o077 or st.st_size > 1024 * 1024:
            fail('OPERATOR_REVIEW_REQUIRED')
        os.lseek(manifest_fd,0,os.SEEK_SET)
        manifest = json.loads(os.read(manifest_fd,1024*1024+1))
        if manifest.get('version') != 1 or manifest.get('approvedByOperator') is not True or any(manifest.get(k) != binding[k] for k in ['targetId','workspaceId','sessionId','policySha256']):
            fail('OPERATOR_REVIEW_REQUIRED')
        expected = manifest.get('files')
        if not isinstance(expected,dict):
            fail('OPERATOR_REVIEW_REQUIRED')
        actual = {name:digest for _,name,directory,digest in entries if not directory and name!='manifest.json'}
        if actual != expected:
            fail('OPERATOR_REVIEW_REQUIRED')
        own='/workspaces/'+binding['workspaceId']
        project=own.replace('/','-').replace('_','-')
        for name in actual:
            allowed = (name.endswith('.jsonl') and name.startswith(('.codex/sessions/','.codex/archived_sessions/', '.claude/projects/'+project+'/'))) or name=='.codex/state_5.sqlite'
            if not allowed or any(part in ['.','..',''] for part in name.split('/')):
                fail('OPERATOR_REVIEW_REQUIRED')
            if name.endswith('.jsonl'):
                fd=next(fd for fd,p,_,_ in entries if p==name)
                os.lseek(fd,0,os.SEEK_SET)
                first=os.read(fd,65536).split(b'\n',1)[0]
                record=json.loads(first)
                cwd=record.get('payload',{}).get('cwd') if name.startswith('.codex/') else record.get('cwd')
                if cwd!=own:
                    fail('OPERATOR_REVIEW_REQUIRED')
            if name=='.codex/state_5.sqlite':
                database=sqlite3.connect('file:'+path+'/'+name+'?mode=ro&immutable=1',uri=True)
                try:
                    if any(row[0]!=own for row in database.execute('SELECT cwd FROM threads')):
                        fail('OPERATOR_REVIEW_REQUIRED')
                finally:
                    database.close()
        return handles, entries, actual
    except Exception:
        for fd in handles:
            os.close(fd)
        raise


def import_export(export, home, uid):
    if export is None:
        return 0
    _, entries, files=export
    home_fd=os.open(home,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for source,name,directory,digest in entries:
            if directory or name not in files:
                continue
            parent=os.dup(home_fd)
            try:
                parts=name.split('/')
                for part in parts[:-1]:
                    try:
                        os.mkdir(part,0o700,dir_fd=parent)
                    except FileExistsError:
                        pass
                    child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
                    st=os.fstat(child)
                    if st.st_uid not in {0,uid} or st.st_gid not in {0,uid}:
                        os.close(child);fail('OPERATOR_REVIEW_REQUIRED')
                    os.fchown(child,uid,uid);os.fchmod(child,0o700)
                    os.close(parent);parent=child
                try:
                    destination=os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
                except FileExistsError:
                    destination=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
                    try:
                        st=os.fstat(destination)
                        if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_uid!=uid or hashlib.file_digest(os.fdopen(os.dup(destination),'rb'),'sha256').hexdigest()!=digest:
                            fail('OPERATOR_REVIEW_REQUIRED')
                    finally:
                        os.close(destination)
                    continue
                try:
                    os.lseek(source,0,os.SEEK_SET)
                    copied=hashlib.sha256()
                    while True:
                        block=os.read(source,65536)
                        if not block:
                            break
                        copied.update(block)
                        view=memoryview(block)
                        while view:
                            view=view[os.write(destination,view):]
                    if copied.hexdigest()!=digest:
                        fail('CONTENT_CHANGED')
                    os.fchown(destination,uid,uid);os.fsync(destination)
                finally:
                    os.close(destination)
            finally:
                os.close(parent)
    finally:
        os.close(home_fd)
    reconcile_native_index(home,uid,files)
    return len(files)


def reconcile_native_index(home,uid,files):
    if '.codex/state_5.sqlite' not in files:return
    # Native rollout paths pointed into the former aggregate home. Rewrite only
    # paths whose exact transcript bytes were explicitly approved and copied.
    path=home+'/.codex/state_5.sqlite'
    database=sqlite3.connect(path)
    try:
        for thread,rollout in database.execute('SELECT id,rollout_path FROM threads').fetchall():
            prefix='/home/researcher/.codex/'
            if not isinstance(rollout,str) or not rollout.startswith(prefix):fail('OPERATOR_REVIEW_REQUIRED')
            relative='.codex/'+rollout[len(prefix):]
            if relative not in files or any(part in ['.','..',''] for part in relative.split('/')):fail('OPERATOR_REVIEW_REQUIRED')
            database.execute('UPDATE threads SET rollout_path=? WHERE id=?',(home+'/'+relative,thread))
        database.commit()
    finally:
        database.close()
    os.chown(path,uid,uid)
    # SQLite may create journal/WAL state; it belongs only to this workspace.
    for suffix in ['-wal','-shm','-journal']:
        if os.path.exists(path+suffix):os.chown(path+suffix,uid,uid)
