from pathlib import Path
import json,os,subprocess,tempfile,unittest

LAUNCHER=Path('/Users/bayou/.local/bin/hermes')
ROOT='/Users/bayou/.hermes'
NATIVE='/Users/bayou/.hermes/hermes-agent/venv/bin/hermes'

class EarlyProfileSelectionTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='dobius-hermes-launcher-')
  self.base=Path(self.temp.name);self.root=self.base/'root'
  for profile in ['adam','friday']:(self.root/'profiles'/profile).mkdir(parents=True)
  (self.root/'active_profile').write_text('adam\n')
  stub=self.base/'native'
  stub.write_text('#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({"home":os.environ.get("HERMES_HOME"),"args":sys.argv[1:]}))\n')
  stub.chmod(0o755)
  self.launcher=self.base/'hermes'
  self.launcher.write_text(LAUNCHER.read_text().replace(NATIVE,str(stub)).replace(ROOT,str(self.root)))
  self.launcher.chmod(0o755)
 def tearDown(self):self.temp.cleanup()
 def run_launcher(self,args=(),inherited=None):
  env=os.environ.copy();env.pop('HERMES_HOME',None)
  if inherited:env['HERMES_HOME']=str(inherited)
  return subprocess.run([str(self.launcher),*args],env=env,capture_output=True,text=True,timeout=5)
 def assert_profile(self,args,profile,inherited=None):
  r=self.run_launcher(args,inherited);self.assertEqual(r.returncode,0,r.stderr)
  d=json.loads(r.stdout);self.assertEqual(d['home'],str(self.root/'profiles'/profile));self.assertEqual(d['args'],list(args))
 def test_plain_start_selects_adam_before_native_imports(self):self.assert_profile([], 'adam')
 def test_friday_flag_overrides_sticky_adam(self):self.assert_profile(['-p','friday','--continue'],'friday')
 def test_inline_profile_preserves_resume_arguments(self):self.assert_profile(['--profile=friday','--resume','a saved title'],'friday')
 def test_inherited_friday_profile_remains_friday(self):self.assert_profile(['--continue'],'friday',self.root/'profiles/friday')
 def test_explicit_adam_overrides_inherited_friday(self):self.assert_profile(['--profile','adam'],'adam',self.root/'profiles/friday')
 def test_default_flag_selects_root(self):
  r=self.run_launcher(['-p','default'],self.root/'profiles/friday')
  self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(json.loads(r.stdout)['home'],str(self.root))
 def test_no_sticky_profile_uses_root(self):
  (self.root/'active_profile').unlink();r=self.run_launcher()
  self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(json.loads(r.stdout)['home'],str(self.root))
 def test_unknown_profile_refuses_without_creating_data(self):
  r=self.run_launcher(['-p','missing'])
  self.assertEqual(r.returncode,2);self.assertFalse((self.root/'profiles/missing').exists());self.assertEqual(r.stdout,'')

if __name__=='__main__':unittest.main()
