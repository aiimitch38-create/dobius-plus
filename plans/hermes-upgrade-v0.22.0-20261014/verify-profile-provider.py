from pathlib import Path
import json,os,sys,time
profile=sys.argv[1]
assert profile in {'adam','friday'}
os.environ['HERMES_HOME']=str(Path('/Users/bayou/.hermes/profiles')/profile)
sys.path.insert(0,'/Users/bayou/.hermes/releases/v0.22.0')
from hermes_cli.auth import resolve_codex_runtime_credentials
from agent.auxiliary_client import resolve_provider_client,shutdown_cached_clients
creds=resolve_codex_runtime_credentials()
assert creds.get('provider')=='openai-codex' and creds.get('auth_mode')=='chatgpt' and bool(creds.get('api_key'))
client,model=resolve_provider_client('openai-codex','gpt-6.1-sol')
assert client is not None and model=='gpt-6.1-sol'
expected=profile.upper()+'_CODEX_VERIFIED'
try:
 response=client.chat.completions.create(model=model,messages=[{'role':'user','content':'Connection check only. Reply exactly '+expected+'. Do not use tools or perform any actions.'}],timeout=30)
 reply=response.choices[0].message.content.strip()
 assert reply==expected,'Unexpected connection-check reply'
 result={'profile':profile,'provider':'openai-codex','auth_mode':'chatgpt','model':model,'real_inference':'PASS','reply':reply,'checked_at':time.time()}
 Path(__file__).with_name(profile+'-verification.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result))
except Exception as exc:
 print(json.dumps({'profile':profile,'real_inference':'FAIL','error_type':type(exc).__name__,'http_status':getattr(exc,'status_code',None)}))
 raise SystemExit(1)
finally:
 shutdown_cached_clients()
