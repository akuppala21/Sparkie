"""Explicit physical qualification helper for cross_workspace.py; never default.

Runs on Spark 2 and targets only Spark 4 using its existing narrow privileges.
After normal shutdown it records measured standby and waits for the operator's
exact operation ID in a private allow-cut file. It does not install anything.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import time


class PowerQualification:
    def __init__(self, config_path, store, binding, node, out):
        from sparkie_sparks.broker import private_json
        from sparkie_sparks.composition import compose
        from sparkie_sparks.idle import IdlePower
        from sparkie_sparks.matter import MatterReader
        from sparkie_sparks.power import FleetPower, PowerMatter, PowerTransport
        config = private_json(config_path)
        assert set(config) == {'node', 'hub_machine_id', 'mapping', 'qualification', 'activity', 'matter_url'}
        expected = config['node']
        assert expected['id'] == 'spark4' and expected['machine_id'] == node.machine_id
        assert expected['address'] == node.host and expected['hostname'] == 'compute4-host.invalid'
        assert set(config['mapping']) == set(config['qualification']) == set(config['activity']) == {'spark4'}
        profile = config['qualification']['spark4']
        assert profile['hold_seconds'] == 60 and profile['off_seconds'] == 10
        assert profile['max_gap_seconds'] <= 15
        self.out, self.store, self.binding, self.config = out, store, binding, config
        self.rows, self.sent, self.wake_receipts = [], [], set()
        transport = PowerTransport(activity_policies=config['activity'])
        matter = PowerMatter(config['mapping'], reader=MatterReader(config['matter_url']))
        observe = matter.observe
        def observed(spark):
            result = observe(spark)
            self.rows.append({key: result.get(key) for key in ('id','observed_at','available','on','watts')})
            self.save()
            return result
        matter.observe = observed
        for name in ('on', 'off_after_shutdown'):
            original = getattr(matter, name)
            def sent(spark, original=original, name=name):
                assert spark == 'spark4'
                self.sent.append({'action': name, 'spark': spark, 'at': datetime.now(timezone.utc).isoformat()})
                self.save()
                return original(spark)
            setattr(matter, name, sent)
        self.power = FleetPower(store, [expected], config['mapping'], hub_machine_id=config['hub_machine_id'],
            matter=matter, transport=transport, qualification=config['qualification'],
            activity=lambda value: transport.activity(value, config['hub_machine_id']))
        self.controls = compose(store, [expected], binding=lambda: binding, power=self.power)
        self.policy = IdlePower(store, self.power, revision='physical-requested-work-20261119',
                               idle_seconds=1800, allow_sleep=False)
        self.operation = None

    def save(self, **more):
        report = {'scope':'Controlled Spark 2 to Spark 4 physical qualification; Spark 1 never targeted.',
            'operation':getattr(self, 'operation', None), 'samples':self.rows, 'sent':self.sent,
            'wake_receipts':sorted(self.wake_receipts), 'qualification':self.config['qualification'], **more}
        (self.out / 'power-observations.json').write_text(json.dumps(report, indent=2) + '\n')

    def sleep_before_work(self):
        from sparkie_sparks.authority import Owner
        owner = Owner(self.binding.generation, 'web')
        row = self.controls.prepare(owner, request_key='physical-sleep', request_ref='Authorized compute qualification',
                                    action='sleep', spark='spark4')
        self.operation = row['id']
        self.controls.confirm(owner, row['id'], row['digest'])
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            observed = self.store.reconcile(row['id'], observe=self.power.observe)
            saved = self.power.sequence._get(row['id'])
            self.save(state=observed['state'], phase=saved['phase'] if saved else None)
            if observed['state'] == 'failed':
                raise RuntimeError('Physical shutdown refused; inspect the retained exact receipt.')
            if saved and saved['phase'] == 'standby':
                break
            time.sleep(5)
        else:
            raise RuntimeError('Standby was not qualified in five minutes. No plug Off was sent.')
        print(json.dumps({'status':'standby_observed_waiting_for_exact_operator_cut', 'operation':row['id'],
                          'approval_file':str(self.out / 'allow-cut')}), flush=True)
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            self.power.observe(row['id'], row['intent'])
            approval = self.out / 'allow-cut'
            if approval.exists() and approval.read_text().strip() == row['id']:
                self.power.advance(row['id'], row['intent'])
                result = self.store.reconcile(row['id'], observe=self.power.observe)
                self.save(state=result['state'], phase=self.power.sequence._get(row['id'])['phase'])
                if result['state'] == 'succeeded':
                    return
            time.sleep(5)
        raise RuntimeError('No exact approved/verified cut completed. Observe retained state before recovery.')

    def ensure_awake(self, allocation):
        self.wake_receipts.add(allocation.operation_id)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            row = self.policy.wake(allocation)
            self.save(wake_state=row['state'])
            if row['state'] == 'succeeded':
                return True
            if row['state'] == 'failed':
                return False
            self.policy.advance(row['id'])
            time.sleep(5)
        return False
