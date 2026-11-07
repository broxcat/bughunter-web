# Disposable, synthetic reviewed export. No tokens, auth or real conversations.
import hashlib,json,os,sys
sys.path.insert(0,'/opt/bughunter/docker/research/broker')
from broker import admitted,ROOT
binding=admitted(open('/fixtures/alice.ticket').read())
root=ROOT+'/exports/'+binding['targetId']
os.makedirs(root,mode=0o700)
files={
 '.codex/sessions/2026/11/07/fixture.jsonl':json.dumps({'type':'session_meta','payload':{'cwd':'/workspaces/'+binding['workspaceId']}})+'\n'+json.dumps({'synthetic':'PRIVATE_A_TRANSCRIPT'})+'\n',
 '.claude/projects/-workspaces-research-m8-alice/00000000-0000-4000-8000-000000000001.jsonl':json.dumps({'cwd':'/workspaces/'+binding['workspaceId'],'synthetic':'PRIVATE_A_CLAUDE_TRANSCRIPT'})+'\n'
}
for path,content in files.items():
 os.makedirs(os.path.dirname(root+'/'+path),exist_ok=True,mode=0o700)
 with open(root+'/'+path,'w')as file:file.write(content)
manifest={'version':1,'approvedByOperator':True,**binding,'files':{path:hashlib.sha256(content.encode()).hexdigest() for path,content in files.items()}}
with open(root+'/manifest.json','w') as file:json.dump(manifest,file)
os.chmod(root+'/manifest.json',0o600)
