import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import struct
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'deploy/upgrade.py'
spec = importlib.util.spec_from_file_location('sparkie_upgrade', SOURCE)
up = importlib.util.module_from_spec(spec)
spec.loader.exec_module(up)


class ApplicationUpgrade(unittest.TestCase):
    def setUp(self):
        self.work = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.releases = self.work/'opt/releases'
        self.current = self.work/'opt/current'
        self.inbox = self.work/'incoming'
        self.receipts = self.work/'journals'
        for p in (self.releases, self.inbox, self.receipts):
            p.mkdir(parents=True)
        self.enterContext(patch.multiple(up, APP=self.releases.parent, RELEASES=self.releases,
                                        CURRENT=self.current, INBOX=self.inbox, RECEIPTS=self.receipts))
        self.base = self.releases/'baseline'
        self.build = self.work/'build/new'
        self.target = self.releases/self.build.name
        self.details = self.work/'details.json'
        self.details.write_text(json.dumps(dict(diff='Prompt changed.',checks='Sealed prompt and startup checks passed.',
            interruption='One gateway and controller restart.',rollback='Restore the same predecessor on failed verification.')))
        for root in (self.base,self.build):
            (root/'extension').mkdir(parents=True)
            (root/'extension/SOUL.md').write_text('previous' if root == self.base else 'reviewed change')
            (root/'hermes').mkdir()
            (root/'hermes/policy.py').write_text('sealed upstream code')
            (root/'hermes/python-link').symlink_to('/opt/sparkie/python/bin/python')
            self.manifest(root)
        self.current.symlink_to(self.base)
        self.id = '1' * 32
        self.offer = up.prepare(self.build, self.base, self.details, self.inbox)
        self.notices = []
        self.check = self.enterContext(patch.object(up, 'check_gateway'))
        self.restart = self.enterContext(patch.object(up, 'run_systemctl'))
        self.authorize = self.enterContext(patch.object(up,'authorize'))
        self.guidance = self.enterContext(patch.object(up,'refresh_guidance'))

    def manifest(self, root):
        files = {str(p.relative_to(root)):up.file_hash(p) for p in root.rglob('*')
                 if not p.is_symlink() and p.is_file() and p.name != 'candidate.json'}
        data = {'files':files,'upstream':{'commit':'sealed'},'model':{'id':'same'},
                'runtime':{'python':str(self.releases/root.name/'hermes/.venv/bin/python'),'base_root':'/opt/sparkie/python'},
                'symlinks':{'hermes/python-link':'/opt/sparkie/python/bin/python'},'native_patches':[]}
        (root/'candidate.json').write_text(json.dumps(data,sort_keys=True))

    def invoke(self, method, proposal=None):
        up.action(method,self.id,proposal or self.offer,self.notices.append)
        return up.load_record(self.id)

    def test_archive_switch_owner_verification_replay_and_same_journal_rollback(self):
        state = self.invoke('apply')
        self.assertEqual((state['state'], self.current.resolve()),('awaiting_owner_check',self.target))
        self.assertEqual((self.target/'extension/SOUL.md').read_text(),'reviewed change')
        self.assertEqual(os.readlink(self.target/'hermes/python-link'),'/opt/sparkie/python/bin/python')
        self.assertEqual(self.invoke('observe')['state'],'awaiting_owner_check')
        self.assertTrue(self.notices[-1]['accept_available'])
        self.assertTrue(self.notices[-1]['rollback_available'])
        self.invoke('apply')
        self.assertEqual(self.restart.call_count, 2)
        self.assertEqual(self.invoke('accept')['state'],'succeeded')
        self.assertEqual(self.invoke('rollback')['state'],'rolled_back')
        self.assertEqual(self.current.resolve(),self.base)
        self.assertEqual(self.invoke('rollback')['state'],'rolled_back')
        self.assertEqual(self.restart.call_count, 4)
        with self.assertRaisesRegex(ValueError,'another proposal'):
            self.invoke('apply','f'*64)

    def test_new_release_does_not_reuse_old_recovery_authority(self):
        self.invoke('apply')
        self.invoke('accept')
        other = self.releases/'third'
        other.mkdir()
        self.current.unlink()
        self.current.symlink_to(other)
        self.invoke('observe')
        self.assertFalse(self.notices[-1]['accept_available'])
        self.assertFalse(self.notices[-1]['rollback_available'])
        with self.assertRaisesRegex(ValueError,'different release'):
            self.invoke('rollback')
        self.assertEqual(self.current.resolve(),other)

    def test_recovery_availability_requires_lock_and_intact_recorded_releases(self):
        self.invoke('apply')
        with (self.receipts/'transaction.lock').open('a+') as lock:
            up.fcntl.flock(lock,up.fcntl.LOCK_EX)
            self.invoke('observe')
            self.assertFalse(self.notices[-1]['rollback_available'])
            self.assertFalse(self.notices[-1]['accept_available'])
        (self.base/'candidate.json').write_text('unexpected predecessor')
        self.invoke('observe')
        self.assertFalse(self.notices[-1]['rollback_available'])
        (self.target/'candidate.json').write_text('unexpected candidate')
        self.invoke('observe')
        self.assertFalse(self.notices[-1]['accept_available'])

    def test_protected_skill_file_roster_requires_separate_review(self):
        for root in (self.base,self.build):
            skill=root/'extension/skills/local-recipe-review'
            skill.mkdir(parents=True)
            (skill/'SKILL.md').write_text('existing native skill')
            self.manifest(root)
        helper=self.build/'extension/skills/local-recipe-review/scripts/read_forum.py'
        helper.parent.mkdir()
        helper.write_text('added after the installed roster')
        self.manifest(self.build)
        with self.assertRaisesRegex(ValueError,'protected skill roster'):
            up.prepare(self.build,self.base,self.details,self.inbox)

    def test_recipe_dashboard_source_and_shipped_assets_share_the_static_scope(self):
        for top in ('extension/recipes_plugin/dashboard','bundled-plugins/sparkie-recipes/dashboard'):
            self.assertTrue(up.application_file(top+'/index.js'))
            self.assertFalse(up.application_file(top+'/plugin_api.py'))
            self.assertFalse(up.application_file(top+'/__pycache__/plugin_api.cpython-314.pyc'))
            original = self.work/'prior-ui.json'
            new = self.work/'new-ui.json'
            original.write_text(json.dumps({'name':'recipes','api':'plugin_api.py','label':'Recipes'}))
            new.write_text(json.dumps({'name':'recipes','api':'plugin_api.py','label':'Serving recipes'}))
            up.checked_difference(top+'/manifest.json',new,original,self.target,self.base)
            new.write_text(json.dumps({'name':'recipes','api':'different-api.py'}))
            with self.assertRaisesRegex(ValueError,'API binding changed'):
                up.checked_difference(top+'/manifest.json',new,original,self.target,self.base)

    def test_health_failure_restores_prior_and_never_records_success(self):
        self.check.side_effect = [ValueError('health failed'), None]
        result = self.invoke('apply')
        self.assertEqual(result['state'],'rolled_back')
        self.assertEqual(self.current.resolve(),self.base)
        self.assertEqual(self.restart.call_count,4)

    def test_owner_revoked_after_materialization_refuses_switch(self):
        self.authorize.side_effect = [None, ValueError('revoked')]
        self.assertEqual(self.invoke('apply')['state'],'failed')
        self.assertEqual(self.current.resolve(),self.base)
        self.restart.assert_not_called()

    def test_inspection_and_stager_refuse_tamper_without_running_candidate(self):
        (self.inbox/self.offer/'review.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'changed'):
            up.review_for(self.offer)
        self.assertFalse(self.target.exists())

    def test_changed_upstream_policy_is_preserved(self):
        (self.build/'hermes/policy.py').write_text('unexpected policy')
        self.manifest(self.build)
        with self.assertRaisesRegex(ValueError,'protected code'):
            up.prepare(self.build,self.base,self.details,self.inbox)
        # A malicious workspace can still handcraft the tar; admission must
        # enforce the same policy without trusting the preparation command.
        with patch.object(up,'checked_difference'):
            self.offer = up.prepare(self.build,self.base,self.details,self.inbox)
        self.assertEqual(self.invoke('apply')['state'],'failed')
        self.assertEqual(self.current.resolve(),self.base)
        self.restart.assert_not_called()

    def test_malformed_approved_tar_and_path_never_escape(self):
        original = up.review_for(self.offer)
        for kind, name in ((tarfile.SYMTYPE,'inside'),(tarfile.LNKTYPE,'hard'),(tarfile.REGTYPE,'../outside'),
                           (tarfile.REGTYPE,'/absolute'),(tarfile.FIFOTYPE,'fifo')):
            with self.subTest(name=name), tempfile.TemporaryDirectory(dir=self.work) as dest:
                archive = Path(dest)/'bad.tar'
                with tarfile.open(archive,'w') as tf:
                    tf.add(self.build/'candidate.json', 'candidate.json')
                    item = tarfile.TarInfo(name)
                    item.type, item.linkname = kind, '../../outside'
                    tf.addfile(item)
                with self.assertRaises((ValueError,tarfile.TarError)):
                    up.materialize(archive,Path(dest),{**original,'archive':up.file_hash(archive)},
                                   self.base,self.target)
        self.assertFalse((self.work/'outside').exists())

    def test_crash_before_switch_reconciles_without_replay(self):
        self.restart.side_effect = KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            self.invoke('apply')
        self.assertEqual(self.invoke('observe')['state'],'unknown')
        self.assertEqual(self.restart.call_count,1)
        self.restart.side_effect = None
        self.assertEqual(self.invoke('rollback')['state'],'rolled_back')

    @unittest.skipUnless(os.geteuid() == 0 and hasattr(socket,'SO_PEERCRED'), 'Linux container root needed for real peer credential tests')
    def test_real_unix_peer_can_only_inspect_as_the_authorized_controller_pid(self):
        address = self.work/'steward.sock'
        self.work.chmod(0o755)
        with socket.socket(socket.AF_UNIX) as server:
            server.bind(str(address))
            address.chmod(0o666)
            server.listen(1)
            pid = os.fork()
            if not pid:
                try:
                    os.setgroups([])
                    os.setgid(1000)
                    os.setuid(1000)
                    with socket.socket(socket.AF_UNIX) as client:
                        client.settimeout(5)
                        client.connect(str(address))
                        client.sendall(json.dumps({'method':'inspect','proposal':self.offer}).encode()+b'\n')
                        with client.makefile('rb') as f:
                            result=json.loads(f.readline())
                        os._exit(0 if result['ok'] and result['review']['release']=='new' else 1)
                except BaseException:
                    os._exit(2)
            with server.accept()[0] as channel, patch.object(up,'run_systemctl',return_value=str(pid)):
                up.serve(channel)
            _, status = os.waitpid(pid,0)
            self.assertEqual(os.waitstatus_to_exitcode(status),0)

    def test_worker_archive_requires_exact_members_including_hub_modules(self):
        import zipfile
        prior=self.work/'prior.zip'
        update=self.work/'update.zip'
        def build_zip(path, hub, worker):
            with zipfile.ZipFile(path,'w') as archive:
                archive.writestr('__main__.py','fixed entrypoint')
                archive.writestr('sparkie_sparks/proposals.py',hub)
                archive.writestr('sparkie_sparks/workspace_remote.py',worker)
        build_zip(prior,'old hub code','fixed worker')
        build_zip(update,'old hub code','fixed worker')
        up.checked_difference('workspace-worker.pyz',update,prior,self.target,self.base)
        build_zip(update,'new hub code','fixed worker')
        with self.assertRaisesRegex(ValueError,'Worker contents changed'):
            up.checked_difference('workspace-worker.pyz',update,prior,self.target,self.base)
        build_zip(update,'new hub code','changed worker')
        with self.assertRaisesRegex(ValueError,'Worker contents changed'):
            up.checked_difference('workspace-worker.pyz',update,prior,self.target,self.base)
        for module in ('proposals.py','research/new_helper.py'):
            self.assertFalse(up.application_file('extension/src/sparkie_sparks/'+module))

    def test_reject_other_same_uid_socket_peer(self):
        first, second = socket.socketpair()
        with first,second,patch.object(up,'run_systemctl',return_value='99999999'):
            with self.assertRaisesRegex(ValueError,'active fleet controller'):
                up.serve(first)

    def test_operation_database_requires_human_generation_and_claim(self):
        db_path = self.work/'operations.sqlite'
        controller = self.work/'controller.json'
        owner = self.work/'owner.json'
        owner.write_text(json.dumps({'generation':'current'}))
        controller.write_text(json.dumps({'operations':str(db_path),'owner_binding':str(owner)}))
        review = up.review_for(self.offer)
        intent = json.dumps({'action':'update_application','proposal':self.offer,'spark':'spark1',
                             'review':up.public_review(review)},sort_keys=True)
        now = time.time()
        with sqlite3.connect(db_path) as db:
            db.execute('CREATE TABLE operations(id,intent,digest,generation,approved_channel,approved_at,expires,state,cancel_requested)')
            db.execute('CREATE TABLE claims(spark,operation)')
            db.execute("INSERT INTO operations VALUES(?,?,?,'current','telegram',?,?,'dispatching',0)",
                       (self.id,intent,up.digest(intent.encode()),now,now+300))
            db.execute("INSERT INTO claims VALUES('spark1',?)",(self.id,))
        with patch.object(up,'CONTROLLER',controller),patch.object(os,'geteuid',return_value=1000),patch.object(os,'getegid',return_value=1000):
            up.read_authorization('begin',self.id,self.offer,review)
            with sqlite3.connect(db_path) as db:
                db.execute('DELETE FROM claims')
            with self.assertRaisesRegex(ValueError,'claim'):
                up.read_authorization('begin',self.id,self.offer,review)
            owner.write_text(json.dumps({'generation':'revoked'}))
            with self.assertRaisesRegex(ValueError,'binding'):
                up.read_authorization('begin',self.id,self.offer,review)


if __name__ == '__main__':
    unittest.main(verbosity=2)
