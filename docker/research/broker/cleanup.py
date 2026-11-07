"""Remove only a revoked registry identity's private home, without following links."""
import os
import stat
from broker import HOMES,ROOT,secure_dir,fail


def remove_home(entry):
    parent=os.open(HOMES,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    count=0
    def remove(directory,name):
        nonlocal count
        count+=1
        if count>100000:
            fail('CLEANUP_LIMIT')
        st=os.stat(name,dir_fd=directory,follow_symlinks=False)
        if stat.S_ISDIR(st.st_mode):
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
            try:
                info=os.fstat(child)
                if info.st_uid not in {0,entry['uid']} or info.st_gid not in {0,entry['gid']}:
                    fail('CLEANUP_UNEXPECTED_OWNER')
                for item in os.listdir(child):
                    remove(child,item)
            finally:
                os.close(child)
            os.rmdir(name,dir_fd=directory)
        else:
            # Symlinks are unlinked themselves, never opened or followed.
            os.unlink(name,dir_fd=directory)
    try:
        name=str(entry['uid'])
        try:st=os.stat(name,dir_fd=parent,follow_symlinks=False)
        except FileNotFoundError:return
        if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_gid!=entry['gid'] or (st.st_mode&0o7777)!=0o750:
            fail('CLEANUP_UNEXPECTED_OWNER')
        remove(parent,name)
        os.fsync(parent)
    finally:
        os.close(parent)


def retain_reviewed_export(entry):
    source=ROOT+'/exports/'+entry['targetId']
    if not os.path.lexists(source):return
    st=os.lstat(source)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_mode&0o022:fail('CLEANUP_UNEXPECTED_OWNER')
    secure_dir(ROOT+'/retained-exports',0o700)
    destination=ROOT+'/retained-exports/'+str(entry['uid'])
    if os.path.lexists(destination):fail('CLEANUP_UNEXPECTED_EXPORT')
    os.rename(source,destination)
