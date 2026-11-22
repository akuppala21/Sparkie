"""Frozen finalist variants using the common native fixture; fresh home per invocation.

Run on a compute Spark with an already allocated one-Spark model. The manifest
selects its explicit route/profile, never a hosted fallback. Original acceptance
receipts and assertions are separate and remain unchanged.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import urlparse
import uuid

from historical_inputs import historical_text

ROOT = Path(__file__).resolve().parents[2]
CORPUS = Path(__file__).with_suffix('')
COMPUTE_IDS = {
    'UNENROLLED_COMPUTE2_MACHINE_ID': 'spark2',
    'UNENROLLED_COMPUTE3_MACHINE_ID': 'spark3',
    'UNENROLLED_COMPUTE4_MACHINE_ID': 'spark4',
}
COMMON_SHA256 = '1d810dd1689480a478ed2979fad936ebc9a4044eea08a09d6f0f98960d3018ba'
MSE_URL = 'https://huggingface.co/DevelopingDad/Qwen3.8-27B-Uncensored-NVFP4-MSE-DGX-Spark/blob/8f517aee51d96323dd706c200b9e94c07418d771/README.md'
CASES = json.loads((CORPUS/'cases.json').read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-manifest', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--prepare-only', action='store_true')
    mode.add_argument('--fixture-only', action='store_true')
    mode.add_argument('--replay-memory-miss', action='store_true',
                      help='Seed the historical wrong-target patch and evaluate native recovery plus recall.')
    parser.add_argument('--variant', choices=tuple(CASES), required=True)
    args = parser.parse_args()
    assert digest(Path(__file__).with_name('comparison.py')) == COMMON_SHA256
    case = CASES[args.variant]
    if args.fixture_only and not args.variant.startswith('coding_'):
        parser.error('Fixture-only verifies a coding fixture, with zero inference.')
    if args.replay_memory_miss and args.variant != 'memory_2':
        parser.error('The wrong-target replay uses the memory_2 chart preference fixture.')
    machine_id = Path('/etc/machine-id').read_text().strip() if sys.platform == 'linux' else ''
    if machine_id not in COMPUTE_IDS:
        parser.error('Use an allocated Linux compute Spark, never Spark 1.')
    identity = json.loads(args.model_manifest.read_text())
    model, endpoint = identity['served_model_name'], identity['base_url']
    profile = identity.get('reasoning_profile', 'qwen-low')
    if profile not in ('qwen-low', 'glm-thinking'):
        parser.error('Use a separately reviewed native Qwen or GLM reasoning profile.')
    url = urlparse(endpoint)
    if url.scheme != 'http' or url.hostname != '127.0.0.1' or url.path != '/v1' or url.username or url.password:
        parser.error('Use the allocated loopback model endpoint.')
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    home = args.out / 'hermes-home'
    home.mkdir(mode=0o700)
    shutil.copytree(ROOT / 'plugin', home / 'plugins/sparkie-sparks')
    shutil.copyfile(ROOT / 'SOUL.md', home / 'SOUL.md')
    shutil.copytree(ROOT / 'skills/local-recipe-review', home / 'skills/local-recipe-review')
    from ruamel.yaml import YAML
    yaml = YAML()
    config = yaml.load(ROOT / 'config/hermes.example.yaml')
    config['model'].update(default=model, base_url=endpoint, context_length=65536)
    provider = config['providers']['sparkie-local']
    provider.update(api=endpoint, default_model=model, context_length=65536)
    if profile == 'glm-thinking':
        provider['extra_body'].pop('reasoning_effort', None)
        provider['extra_body']['chat_template_kwargs'] = {'enable_thinking': True}
        config['agent'].pop('reasoning_effort', None)
    config['auxiliary']['vision'].update(model=model, base_url=endpoint)
    config['terminal'].update(backend='docker', cwd='/workspace', docker_network=False)
    assert config['terminal']['docker_mount_cwd_to_workspace'] is False
    assert all(config['terminal'][key] == [] for key in
               ('docker_volumes', 'docker_forward_env', 'credential_files', 'env_passthrough'))
    assert not config['terminal'].get('docker_extra_args')
    with (home / 'config.yaml').open('w') as stream:
        yaml.dump(config, stream)
    for key in list(os.environ):
        if key.endswith(('_API_KEY', '_TOKEN', '_PASSWORD', '_SECRET')):
            os.environ.pop(key)
    os.environ.pop('SPARKIE_CONTROL_SOCKET', None)
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1',
                      HF_HUB_OFFLINE='1', NO_PROXY='*', PYTHONDONTWRITEBYTECODE='1')

    def audit(event, values):
        if event == 'socket.connect':
            address = values[1]
            if not isinstance(address, tuple) or address[:2] != ('127.0.0.1', url.port or 80):
                raise PermissionError('Only allocated local inference is available to the runner.')
    sys.addaudithook(audit)
    from run_agent import AIAgent
    import run_agent
    from hermes_cli.config import apply_terminal_config_to_env
    from hermes_cli.plugins import get_plugin_manager, PluginContext, PluginManifest
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from tools.registry import discover_builtin_tools, registry
    from toolsets import create_custom_toolset
    from tools import terminal_tool as terminal
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from sandbox_cleanup import NativeSandboxCleanup
    from tools.file_tools import write_file_tool, read_file_tool
    from tools.environments.docker import DockerEnvironment
    from gateway.session_context import set_session_vars, clear_session_vars
    from sparkie_sparks.authority import Owner, OwnerBinding
    from sparkie_sparks.controls import Controls
    from sparkie_sparks.operations import OperationStore
    from sparkie_sparks import controls, telegram_controls
    import httpx
    apply_terminal_config_to_env(config=config, override=True)
    get_plugin_manager().discover_and_load()
    discover_builtin_tools()
    runtime = resolve_runtime_provider(requested=config['model']['provider'], target_model=model)
    assert runtime['base_url'].rstrip('/') == endpoint.rstrip('/')
    assert runtime['provider'] == 'custom' and runtime['api_mode'] == 'chat_completions'
    assert provider['api'] == endpoint and config['model']['default'] == provider['default_model'] == model
    kwargs = {k: runtime.get(k) for k in ('base_url', 'provider', 'api_key', 'api_mode', 'requested_provider', 'request_overrides')}
    kwargs['reasoning_config'] = {'enabled': True, 'effort': 'low'} if profile == 'qwen-low' else {'enabled': True}
    tools_by_group = {'read': ['read_file'], 'code': ['read_file', 'write_file', 'patch', 'terminal'],
                      'operations': ['spark_propose_change', 'spark_change_status', 'spark_check_change']}
    for name, names in tools_by_group.items():
        assert all(registry.get_entry(x) is not None for x in names), names
        create_custom_toolset('comparison-' + name, 'Native comparison tools with isolated state', tools=names)
    assert telegram_controls._delivery is None
    from agent.skill_commands import build_auto_load_prompt
    _, loaded, missing = build_auto_load_prompt(user_config=config, home_override=home)
    assert loaded == ['local-recipe-review'] and not missing
    native = Path(run_agent.__file__).resolve().parent
    upstream = json.loads((ROOT/'upstream.lock.json').read_text())
    native_files = ['run_agent.py', 'hermes_state.py', 'hermes_cli/runtime_provider.py',
                    'hermes_cli/plugins_context.py', 'tools/terminal_tool.py',
                    'tools/environments/docker.py', 'tools/file_tools.py', 'uv.lock', 'pyproject.toml']
    report = {'host': socket.gethostname(), 'machine_id':machine_id, 'spark':COMPUTE_IDS[machine_id],
              'started_at': datetime.now(timezone.utc).isoformat(),
              'identity': identity, 'reasoning_profile': profile, 'semantic_review_required': True,
              'model_manifest_sha256':digest(args.model_manifest),
              'native':{'pin':upstream, 'source_path':str(native),
                        'files':{name:digest(native/name) for name in native_files}},
              'scope': 'Fresh finalist variant; real native tools/memory; inert fleet effects.', 'variant': args.variant, 'common_fixture_sha256': COMMON_SHA256,
              'inputs': {str(p.relative_to(ROOT)): digest(p) for p in [Path(__file__), ROOT/'SOUL.md', ROOT/'tests/sandbox_cleanup.py',
                  ROOT/'src/sparkie_sparks/memory_controls.py', ROOT/'plugin/__init__.py',
                  ROOT/'skills/local-recipe-review/SKILL.md', ROOT/'config/hermes.example.yaml',
                  ROOT/'src/sparkie_sparks/proposals.py', ROOT/'src/sparkie_sparks/operations.py',
                  ROOT/'src/sparkie_sparks/controls.py', ROOT/'src/sparkie_sparks/fleet.py', ROOT/'src/sparkie_sparks/energy.py', Path(__file__).with_name('comparison.py'),
                  ROOT/'upstream.lock.json', ROOT/'config/sandbox.lock.json',
                  *sorted(CORPUS.glob('*')), *sorted(Path(__file__).with_name('comparison').glob('*'))] if p.is_file()},
              'resolved_config_sha256': digest(home/'config.yaml'), 'cases': []}
    (args.out/'model-manifest.json').write_text(json.dumps(identity, indent=2)+'\n')
    wire, current_case = [], None
    original_send = httpx.Client.send
    def trace(client, request, *a, **kw):
        if request.url.path.endswith('/chat/completions'):
            body = json.loads(request.content)
            entry = {'case': current_case, 'url': str(request.url), 'sent_at': datetime.now(timezone.utc).isoformat(),
                     **{k: body.get(k) for k in ('model','temperature','top_p','top_k','reasoning_effort','chat_template_kwargs','max_tokens','response_format')}}
            wire.append(entry)
            with (args.out/'wire.jsonl').open('a') as f: f.write(json.dumps(entry)+'\n')
            assert request.url.host == '127.0.0.1' and request.url.port == url.port and body.get('model') == model
            assert body.get('temperature') == 1.0 and body.get('top_p') == .95 and body.get('top_k') == 20
            if profile == 'qwen-low':
                assert body.get('reasoning_effort') == 'low'
                assert body.get('chat_template_kwargs') == {'enable_thinking': True, 'thinking': True, 'reasoning_effort': 'low'}
            else:
                assert body.get('chat_template_kwargs', {}).get('enable_thinking') is True
                assert body.get('reasoning_effort') is None, 'GLM thinking has no claimed Qwen low-effort mapping.'
        return original_send(client, request, *a, **kw)
    httpx.Client.send = trace
    observed, effects, operation_calls = {}, [], []
    binding = OwnerBinding('comparison-fixture', 'fixture-owner', 'basic', '', 12345, 12345)
    owner = Owner(binding.generation, 'web')
    store = OperationStore(args.out/'operations.sqlite')
    service = Controls(store, binding=lambda: binding, dispatch=lambda *a: effects.append(a),
                       observe=lambda op, *a: observed.get(op, 'unknown'))
    controls._controls = service
    originals = {}
    for name in tools_by_group['operations']:
        entry = registry.get_entry(name)
        originals[name] = entry.handler
        def capture(arguments, _name=name, **kw):
            value = originals[_name](arguments, **kw)
            operation_calls.append({'tool': _name, 'arguments': arguments, 'result': json.loads(value)})
            return value
        entry.handler = capture
    def memory():
        return {p.name: p.read_text() for p in sorted((home/'memories').glob('*.md'))}
    def command(session, text):
        return json.loads(terminal.terminal_tool(text, task_id=session, timeout=60))
    def write(session, path, text):
        result = json.loads(write_file_tool(path, text, task_id=session))
        assert not result.get('error'), result
    def save():
        (args.out/'summary.json').write_text(json.dumps(report, indent=2, default=str)+'\n')
    def run(name, prompt, group=None, *, budget=240, tokens=3072, iterations=6, use_memory=False, files=None, coding=False, code_filename=None, history=None):
        nonlocal current_case
        current_case = name
        session = uuid.uuid4().hex
        context = set_session_vars(session_key=session, platform='telegram', chat_id='12345',
                                   chat_type='private', actor_id='12345', message_id=name)
        start, timing, before_memory = None, {}, memory()
        before_effects, before_calls, before_wire = len(effects), len(operation_calls), len(wire)
        receipt = {'name': name, 'prompt': prompt, 'session': session, 'memory_before': before_memory,
                   'budget_seconds': budget, 'max_tokens': tokens, 'max_iterations': iterations}
        cleanup = NativeSandboxCleanup(home)
        agent = None
        def mark(key, value):
            if start is not None and value and key not in timing: timing[key] = round(time.monotonic()-start,3)
        try:
            for path, content in (files or {}).items(): write(session,path,content)
            if files:
                cleanup.capture()
            if coding:
                assert code_filename in ('fleet.py', 'energy.py')
                setup = command(session, f'cd /workspace && git config --global --add safe.directory /workspace && git init -q && git add {code_filename} test_case.py && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm baseline')
                assert setup['exit_code'] == 0, setup
                receipt['before_test'] = command(session,'cd /workspace && python3 -B test_case.py')
                assert receipt['before_test']['exit_code'] != 0 and 'FAIL' in receipt['before_test']['output']
            agent = AIAgent(**kwargs, model=model, session_id=session,
                enabled_toolsets=['skills','no_mcp'] + (['comparison-'+group] if group else []) + (['memory'] if use_memory else []),
                disabled_toolsets=config['agent']['disabled_toolsets'], max_iterations=iterations, max_tokens=tokens,
                run_budget_seconds=budget, quiet_mode=True, cwd='/workspace', skip_context_files=False,
                skip_memory=not use_memory, skip_background_review=True,
                stream_delta_callback=lambda value: mark('first_text_seconds', value.strip() if value else None),
                tool_gen_callback=lambda value: mark('first_tool_seconds',value))
            start = time.monotonic()
            result = agent.run_conversation(prompt, conversation_history=history)
            receipt.update({k:result.get(k) for k in ('completed','final_response','api_calls','messages','error')})
            receipt['seconds'] = round(time.monotonic()-start,3)
            receipt['native_soul_loaded'] = 'You are Sparkie, a local assistant for the enrolled owner' in str(agent._cached_system_prompt)
            receipt['native_skills_loaded'] = getattr(agent,'_auto_load_skills_result',('',[],[]))[1]
            if coding:
                receipt['after_test'] = command(session,'cd /workspace && python3 -B test_case.py')
                receipt['diff'] = command(session,f'cd /workspace && git diff -- {code_filename} && git diff --exit-code -- test_case.py && git status --short')
                receipt['test_hash_readback'] = command(session,'cd /workspace && sha256sum test_case.py')
                expected_test_hash = hashlib.sha256(files['/workspace/test_case.py'].encode()).hexdigest()
                receipt['tests_unchanged'] = (command(session,'cd /workspace && git diff --exit-code -- test_case.py')['exit_code'] == 0
                    and receipt['test_hash_readback']['exit_code'] == 0
                    and receipt['test_hash_readback']['output'].split()[0] == expected_test_hash)
                receipt['test_readback'] = json.loads(read_file_tool('/workspace/test_case.py',task_id=session))
                receipt['edited_file'] = json.loads(read_file_tool('/workspace/'+code_filename,task_id=session))
        except Exception as exc:
            receipt.update(completed=False,error_type=type(exc).__name__,error=str(exc))
        finally:
            receipt.update(timing=timing,memory_after=memory(),operation_calls=operation_calls[before_calls:],
                           effect_count=len(effects)-before_effects,wire_generation_fields=wire[before_wire:])
            receipt['sandbox_cleanup'] = cleanup.finish(required=bool(files))
            cleanup_errors = [{'stage': 'native sandbox', 'error': error}
                              for error in receipt['sandbox_cleanup']['errors']]
            for label,action in [('agent.close',lambda:agent.close() if agent is not None else None),
                                 ('session context',lambda:clear_session_vars(context))]:
                try: action()
                except Exception as exc: cleanup_errors.append({'stage':label,'error':str(exc)})
            receipt['cleanup_errors']=cleanup_errors
            (args.out/(name+'.json')).write_text(json.dumps(receipt,indent=2,default=str)+'\n')
            report['cases'].append({'name':name,'completed':receipt.get('completed'), 'error_type':receipt.get('error_type'),
                                    'seconds':receipt.get('seconds'),'timing':timing,'wire_calls':len(wire)-before_wire,
                                    'operation_reads':len(operation_calls)-before_calls,'effect_count':receipt['effect_count']})
            save()
            if cleanup_errors:
                raise RuntimeError('Case receipt saved; stop after native cleanup failure to avoid resource interference.')
        return receipt
    try:
        # Prove native tools and Docker isolation before any comparison request.
        session=uuid.uuid4().hex
        context=set_session_vars(session_key=session,platform='cli')
        preflight_cleanup = NativeSandboxCleanup(home)
        try:
            write(session,'/workspace/comparison-preflight.txt','native comparison preflight\n')
            read=json.loads(read_file_tool('/workspace/comparison-preflight.txt',task_id=session))
            assert 'native comparison preflight' in json.dumps(read)
            check=command(session,'python3 -c "print(6 * 7)"')
            assert check['exit_code']==0 and '42' in check['output']
            with terminal._env_lock:
                envs=[x for x in terminal._active_environments.values() if isinstance(x,DockerEnvironment)]
            assert len(envs)==1
            metadata=json.loads(subprocess.run(['docker','inspect',envs[0]._container_id],capture_output=True,text=True,check=True).stdout)[0]
            host=metadata['HostConfig']
            assert host['NetworkMode']=='none' and host['Privileged'] is False
            assert host['Memory']==4096*1024*1024 and host['NanoCpus']==1000000000
            mounts=metadata.get('Mounts',[])
            writable = {str(home/'sandboxes/docker/default/home'), str(home/'sandboxes/docker/default/workspace')}
            assert all(x['Type']!='bind' or (Path(x['Source']).is_relative_to(home)
                       and (not x['RW'] or x['Source'] in writable)) for x in mounts), mounts
            env_keys=[]
            for item in metadata['Config']['Env']:
                key,_,value=item.partition('=');env_keys.append(key)
                assert not(value and key.endswith(('_API_KEY','_TOKEN','_PASSWORD','_SECRET'))),key
            report['sandbox']={'image_id':metadata['Image'],'image_reference':metadata['Config']['Image'],
                'network':host['NetworkMode'],'memory_limit_bytes':host['Memory'],'nano_cpus':host['NanoCpus'],
                'privileged':host['Privileged'],'mounts':mounts,'environment_keys':env_keys,
                'storage_limit':'Native disk quota unavailable on this host storage driver; no disk-quota claim.'}
        finally:
            report['preflight_cleanup'] = preflight_cleanup.finish()
            clear_session_vars(context)
            if not report['preflight_cleanup']['verified']:
                raise RuntimeError(report['preflight_cleanup']['errors'])
        report['preflight']={'passed':True,'inference_calls':len(wire),'endpoint':runtime['base_url'],'alias':model,
                             'native_tools':'Real DockerEnvironment read/write/terminal; no replacement transport'}
        assert not wire
        if args.prepare_only:
            save(); print(json.dumps(report['preflight'])); return 0
        if args.variant.startswith('research_'):
            source=json.loads(historical_text('comparison/held-out-sources.json'))[case['source']]
            files={'/workspace/MSE.md': MSE_URL+'\n'+historical_text('finalist/MSE.md'),
                   '/workspace/'+case['filename']: source['title']+'\n'+source['url']+'\n'+source['text']}
            run(args.variant,case['prompt'],'read',tokens=4096,files=files)
        elif args.variant.startswith('coding_'):
            source=(ROOT/'src/sparkie_sparks'/case['filename']).read_text()
            assert source.count(case['original']) == 1
            broken=source.replace(case['original'],case['broken'],1)
            assert broken != source
            tests=(CORPUS/(args.variant+'_test.txt')).read_text()
            files={'/workspace/'+case['filename']:broken,'/workspace/test_case.py':tests}
            report['fixture']={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),
                'broken_sha256':hashlib.sha256(broken.encode()).hexdigest(),
                'test_sha256':hashlib.sha256(tests.encode()).hexdigest(),
                'substitutions':1,'source_file':case['filename']}
            if args.fixture_only:
                session=uuid.uuid4().hex
                context=set_session_vars(session_key=session,platform='cli')
                fixture_cleanup = NativeSandboxCleanup(home)
                try:
                    for path,text in files.items():write(session,path,text)
                    before=command(session,'cd /workspace && python3 -B test_case.py')
                    assert before['exit_code'] != 0 and 'FAIL' in before['output'],before
                    write(session,'/workspace/'+case['filename'],source)
                    after=command(session,'cd /workspace && python3 -B test_case.py')
                    assert after['exit_code']==0,after
                    report['fixture_verification']={'broken':before,'reference':after,'inference_calls':len(wire)}
                    assert not wire
                finally:
                    report['fixture_cleanup'] = fixture_cleanup.finish()
                    clear_session_vars(context)
                    if not report['fixture_cleanup']['verified']:
                        raise RuntimeError(report['fixture_cleanup']['errors'])
            else:
                run(args.variant,case['prompt'],'code',budget=360,tokens=4096,iterations=12,
                    coding=True,code_filename=case['filename'],files=files)
        elif args.replay_memory_miss:
            from agent.agent_runtime_helpers import invoke_tool
            from tools.memory_tool import load_on_disk_store
            from types import SimpleNamespace
            old = 'Prefers PNG as the test chart export format.'
            seed = SimpleNamespace(session_id='fixture-seed', _memory_store=load_on_disk_store(), _memory_manager=None)
            assert json.loads(invoke_tool(seed, 'memory', {'target': 'user', 'operations': [
                {'action': 'add', 'content': old}]}, seed.session_id))['success'] is True
            wrong = {'target': 'memory', 'operations': [
                {'action': 'patch', 'old_text': old, 'content': 'Prefers SVG as the test chart export format.'}]}
            failed = invoke_tool(seed, 'memory', wrong, seed.session_id, tool_call_id='fixture-miss')
            native = json.loads(failed)
            assert native['success'] is False and 'correction_hint' in native
            replay = [{'role': 'user', 'content': case['prompts'][1]},
                      {'role': 'assistant', 'content': '', 'tool_calls': [
                          {'id': 'fixture-miss', 'type': 'function', 'function': {
                              'name': 'memory', 'arguments': json.dumps(wrong)}}]},
                      {'role': 'tool', 'name': 'memory', 'tool_call_id': 'fixture-miss', 'content': failed}]
            corrected = run('memory_recovery', 'Please finish that correction.', use_memory=True, budget=120, history=replay)
            fresh = load_on_disk_store()
            recalled = run('memory_fresh_recall', case['prompts'][2], use_memory=True, budget=120)
            checks = {'correction_completed': corrected.get('completed') is True,
                      'original_entry_updated_without_competing_entry': len(fresh.user_entries) == 1
                          and 'SVG' in fresh.user_entries[0] and fresh.user_entries != [old] and not fresh.memory_entries,
                      'fresh_session_recalled_svg': recalled.get('completed') is True
                          and 'SVG' in (recalled.get('final_response') or ''),
                      'distinct_sessions': corrected['session'] != recalled['session']}
            report['memory_recovery'] = {'seeded_wrong_target': wrong, 'native_failed_result': native,
                'user_entries_after_correction': fresh.user_entries, 'memory_entries_after_correction': fresh.memory_entries,
                'checks': checks}
            if not all(checks.values()):
                raise RuntimeError('Model recovery checks failed. See native memory and conversation receipts.')
        elif args.variant.startswith('memory_'):
            for phase,prompt in zip(('save','correct','recall'),case['prompts']):
                run(args.variant+'_'+phase,prompt,use_memory=True,budget=120)
        elif args.variant.startswith('operation_'):
            row=store.prepare(owner,request_key='fixture-'+args.variant,request_ref='inert existing owner-approved fixture',
                              action='stop_workload',spark=case['spark'],container=case['container'])
            observed[row['id']]='unknown'
            store.run(owner,row['id'],approval_digest=row['digest'],dispatch=service.dispatch,observe=service.observe)
            observed[row['id']]=case['observed']
            r=run(args.variant,case['prompt'].format(id=row['id']),'operations')
            with store._db() as db:claim=db.execute('SELECT operation FROM claims WHERE spark=?',(case['spark'],)).fetchone()
            record={'id':row['id'],'state':store.get(row['id'])['state'],'claim':claim[0] if claim else None,
                    'observed_fixture_result':case['observed'],'model_effect_count':r['effect_count']}
            (args.out/(args.variant+'-state.json')).write_text(json.dumps(record,indent=2)+'\n')

    finally:
        for name,handler in originals.items(): registry.get_entry(name).handler=handler
        controls._controls=None
        httpx.Client.send=original_send
        report['finished_at']=datetime.now(timezone.utc).isoformat()
        report['total_inference_calls']=len(wire)
        report['scoring']='Pending independent correctness/safety/efficiency review; no numeric pass inferred.'
        save()
    print(json.dumps({'finished_at':report['finished_at'],'cases':len(report['cases']),'inference_calls':len(wire),'semantic_review_required':True}))
    return 0


if __name__=='__main__':
    raise SystemExit(main())
