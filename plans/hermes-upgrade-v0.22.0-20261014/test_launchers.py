"""Profile aliases must pin home before the upstream-managed launcher runs."""
from pathlib import Path
import json, os, subprocess, tempfile, unittest

class ProfileAliasTests(unittest.TestCase):
 def check_alias(self, profile, arguments, inherited=None):
  with tempfile.TemporaryDirectory(prefix='dobius-hermes-upgrade-launcher-') as directory:
   base=Path(directory);stub=base/'native'
   stub.write_text('#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({"home":os.environ.get("HERMES_HOME"),"args":sys.argv[1:]}))\n');stub.chmod(0o755)
   alias=base/'alias';original=Path('/Users/bayou/.local/bin/hermes-'+profile).read_text()
   alias.write_text(original.replace('/Users/bayou/.local/bin/hermes',str(stub)));alias.chmod(0o755)
   environment=os.environ.copy();environment.pop('HERMES_HOME',None)
   if inherited:environment['HERMES_HOME']=inherited
   result=subprocess.run([str(alias),*arguments],env=environment,capture_output=True,text=True,timeout=5)
   self.assertEqual(result.returncode,0,result.stderr);actual=json.loads(result.stdout)
   self.assertEqual(actual['home'],'/Users/bayou/.hermes/profiles/'+profile)
   self.assertEqual(actual['args'],['-p',profile,*arguments])
 def test_adam_tui_resume(self):self.check_alias('adam',['--tui','--resume','20261014_135102_157d0a'])
 def test_friday_tui_resume(self):self.check_alias('friday',['--tui','--resume','20261014_135702_7dfb85'])
 def test_adam_overrides_inherited_friday_home(self):self.check_alias('adam',['--continue'],'/Users/bayou/.hermes/profiles/friday')
 def test_friday_overrides_inherited_adam_home(self):self.check_alias('friday',['--continue'],'/Users/bayou/.hermes/profiles/adam')

if __name__=='__main__':unittest.main()
