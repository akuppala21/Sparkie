"""Reviewed one-Spark Compose recipes. Paths and placement come from private enrollment."""

import hashlib
import json
from pathlib import Path

from .recipe_services import ServiceRecipe

ARTIFACTS = 'artifact-browser'
GLM = 'glm-flash'
MODEL = 'sparkie-glm-worker'
DEFINITIONS = {
    ARTIFACTS: {
        'kind': 'app',
        'image': 'python@sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8',
        'network': 'loopback-published-bridge',
        'port': 32382,
        'memory_mb': 128,
        'cpu': 1,
        'gpu': 0,
        'entrypoint': ['python', '-I', '-u', '-c'],
        'command': [
            """import http.server, os, stat
from pathlib import Path
class Artifacts(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # Open each component relative to a pinned directory descriptor. A
        # symlink in a generated artifact cannot expose other container files.
        parts = Path(self.translate_path(self.path)).relative_to('/artifacts').parts
        fd = os.open('/artifacts', os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in parts:
                child = os.open(part, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                os.close(fd)
                fd = child
            info = os.fstat(fd)
            if stat.S_ISDIR(info.st_mode):
                if not self.path.split('?', 1)[0].endswith('/'):
                    self.send_error(404)
                    return
                return self.list_directory('/proc/self/fd/' + str(fd))
            if not stat.S_ISREG(info.st_mode):
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-type', self.guess_type(self.path))
            self.send_header('Content-Length', str(info.st_size))
            self.end_headers()
            return os.fdopen(os.dup(fd), 'rb')
        except OSError:
            self.send_error(404)
        finally:
            os.close(fd)
    def do_GET(self):
        if self.path != '/__sparkie_health':
            return super().do_GET()
        body = os.environ['SPARKIE_INSTANCE'].encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
os.chdir('/artifacts')
http.server.ThreadingHTTPServer(('0.0.0.0', 8000), Artifacts).serve_forever()
"""
        ],
    },
    GLM: {
        'kind': 'model',
        'model': MODEL,
        'repository': 'operationrange/GLM-4.7-Flash-abliterated-FP8-Dynamic',
        'weights_revision': 'ad83565947882bd7cff9bc05da85891092d29a73',
        'image': 'eugr/spark-vllm-b12x@sha256:03a956544e9f9b4b7ba91690469fbe7848bdbef29a7d2e0f5788368467bb3595',
        'network': 'loopback-published-bridge',
        'port': 32381,
        'memory_mb': 102400,
        'cpu': 16,
        'gpu': 1,
        'entrypoint': ['python3', '-m', 'vllm.entrypoints.openai.api_server'],
        'command': [
            '--model',
            '/weights',
            '--served-model-name',
            MODEL,
            '--host',
            '0.0.0.0',
            '--port',
            '8000',
            '--max-model-len',
            '65536',
            '--max-num-seqs',
            '2',
            '--gpu-memory-utilization',
            '0.60',
            '--enable-prefix-caching',
            '--enable-auto-tool-choice',
            '--tool-call-parser',
            'glm47',
            '--reasoning-parser',
            'glm45',
        ],
        'files': {
            'chat_template.jinja': 'd63ad536c3c81880043e22ec7fd08db42b4d8fb7c89c7138bc562bfa25281375',
            'config.json': '1c88fff9022309d438d72f363676f9a922c25e6fcc7cf9d31e3fb4bf3f59af4c',
            'generation_config.json': '7f5d6ebc19b24b4ed46e338ed7bdba42eda79336955cf7074f568f15413cbc8b',
            'model-00001-of-00002.safetensors': 'd52e72e749a1b8481748a6aa862ed02b10fdca07745a8ae3e19db5b089332ba4',
            'model-00002-of-00002.safetensors': 'dbea8d829e3fb60ad8cd7d354825fb23f69453d9a405b6f2fa9a94be996d8227',
            'model.safetensors.index.json': 'd75ed584a1fa7e7b517f3d653a7c5841ee6196fe31ebc7dfa79f3c82951023db',
            'tokenizer.json': '19e773648cb4e65de8660ea6365e10acca112d42a854923df93db4a6f333a82d',
            'tokenizer_config.json': '1948783b2bf57874a71df71f8629014f027ace62d58724e555766f0993d6dc19',
        },
    },
}


def recipe(name, nodes):
    d = DEFINITIONS[name]
    # Seal exactly the image, inputs, command, resource policy and Compose
    # fields. Physical placement and instance identity remain separately bound.
    template = _compose(name, 'INSTANCE', 'MACHINE', '/INPUT', '/CACHE', 'REVISION')
    record = json.dumps({'recipe': d, 'compose': template}, sort_keys=True, separators=(',', ':'))
    revision = hashlib.sha256(record.encode()).hexdigest()
    return ServiceRecipe(name, revision, d['kind'], tuple(nodes), d['port'], d.get('model'))


def resources(name):
    return {key: DEFINITIONS[name][key] for key in ('cpu', 'memory_mb', 'gpu')}


def compose_file(name, instance, machine, data, cache):
    return _compose(name, instance, machine, data, cache, recipe(name, ()).revision)


def _compose(name, instance, machine, data, cache, revision):
    d = DEFINITIONS[name]

    def mount(source, target, readonly):
        return {
            'type': 'bind',
            'source': str(source),
            'target': target,
            'read_only': readonly,
            'bind': {'create_host_path': False},
        }

    service = {
        'image': d['image'],
        'pull_policy': 'never',
        'container_name': 'sparkie-' + instance,
        'entrypoint': d['entrypoint'],
        'command': d['command'],
        'ports': [{'target': 8000, 'published': str(d['port']), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}],
        'restart': 'unless-stopped',
        'user': '1000:1000',
        'read_only': True,
        'cap_drop': ['ALL'],
        'security_opt': ['no-new-privileges:true'],
        'tmpfs': ['/tmp:rw,nosuid,nodev,mode=1777,size=1g'],
        'mem_limit': str(d['memory_mb']) + 'm',
        'memswap_limit': str(d['memory_mb']) + 'm',
        'cpus': d['cpu'],
        'pids_limit': 2048 if name == GLM else 64,
        'labels': {
            'sparkie.protected': 'true',
            'sparkie.instance': instance,
            'sparkie.recipe': name,
            'sparkie.machine': machine,
            'sparkie.revision': revision,
        },
        'environment': {'SPARKIE_INSTANCE': instance},
        'volumes': [],
        'logging': {'driver': 'local', 'options': {'max-size': '4m', 'max-file': '2'}},
    }
    if name == ARTIFACTS:
        service['init'] = True
        service['volumes'].append(mount(data, '/artifacts', True))
    else:
        # Bind only individually verified inference inputs. The runtime cannot load
        # a sidecar Python module, config override or other unreviewed model file.
        service['volumes'] = [
            mount(Path(data) / filename, '/weights/' + filename, True) for filename in d['files']
        ]
        service['volumes'].append(mount(cache, '/cache', False))
        service.update(gpus='all', shm_size='16g')
        service['environment'].update(
            HOME='/cache',
            HF_HOME='/cache/hf',
            VLLM_CACHE_ROOT='/cache/vllm',
            XDG_CACHE_HOME='/cache/xdg',
            HF_HUB_OFFLINE='1',
            TRANSFORMERS_OFFLINE='1',
            VLLM_NO_USAGE_STATS='1',
            HF_HUB_DISABLE_TELEMETRY='1',
            HF_HUB_DISABLE_IMPLICIT_TOKEN='1',
            GLOO_SOCKET_IFNAME='lo',
            NCCL_SOCKET_IFNAME='lo',
            DO_NOT_TRACK='1',
        )
    return {'services': {'service': service}}
