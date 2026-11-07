# Explicit synthetic operator review of real native, inference-free histories.
import hashlib,json,os,shutil,sqlite3,sys
sys.path.insert(0,'/opt/bughunter/docker/research/broker')
from broker import admitted,ROOT
suffix=sys.argv[1] if len(sys.argv)>1 else 'alice'
binding=admitted(open('/fixtures/'+suffix+'.ticket').read())
root=ROOT+'/exports/'+binding['targetId']
os.makedirs(root,mode=0o700)
threads=json.load(open('/tmp/legacy-threads.json'))
selected=threads[suffix]['id']
source='/home/researcher/.codex'
database=sqlite3.connect('file:'+source+'/state_5.sqlite?mode=ro',uri=True)
try:
 columns={row[1] for row in database.execute('PRAGMA table_info(threads)')}
 path=database.execute('SELECT rollout_path FROM threads WHERE id=?',(selected,)).fetchone()[0]
 destination=root+'/.codex/state_5.sqlite';os.makedirs(os.path.dirname(destination),exist_ok=True,mode=0o700)
 target=sqlite3.connect(destination);database.backup(target)
 target.execute('PRAGMA foreign_keys=ON')
 target.execute('DELETE FROM threads WHERE id<>?',(selected,))
 # Explicit review fixture removes other thread-associated rows as well.
 for (table,) in target.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
  if not table.replace('_','').isalnum():raise ValueError('Unexpected table')
  names={row[1] for row in target.execute('PRAGMA table_info("'+table+'")')}
  if 'thread_id' in names:target.execute('DELETE FROM "'+table+'" WHERE thread_id<>?',(selected,))
 target.commit();target.execute('VACUUM');target.close()
finally:database.close()
relative='.codex/'+os.path.relpath(path,source)
os.makedirs(os.path.dirname(root+'/'+relative),exist_ok=True,mode=0o700)
shutil.copyfile(path,root+'/'+relative)
claude='.claude/projects/-workspaces-research-m8-'+suffix+'/00000000-0000-4000-8000-000000000001.jsonl'
os.makedirs(os.path.dirname(root+'/'+claude),exist_ok=True,mode=0o700)
with open(root+'/'+claude,'w')as file:file.write(json.dumps({'cwd':'/workspaces/'+binding['workspaceId'],'synthetic':'PRIVATE_'+suffix.upper()+'_CLAUDE_TRANSCRIPT'})+'\n')
files={}
for directory,_,names in os.walk(root):
 for name in names:
  file=os.path.join(directory,name);relative=os.path.relpath(file,root);files[relative]=hashlib.sha256(open(file,'rb').read()).hexdigest()
manifest={'version':1,'approvedByOperator':True,**binding,'files':files}
with open(root+'/manifest.json','w')as file:json.dump(manifest,file)
os.chmod(root+'/manifest.json',0o600)
