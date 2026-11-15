# Spark Console's per-Spark worker: status, workloads, logs, diagnostics, and files in a Spark's shared folder (list, read
# and write; never delete, rename or make a folder). It started as the
# original Spark Portal's worker.py (hence the spark-portal paths and service names it still uses on each Spark).
# Spark Console runs it on each Spark over SSH, like the portal did: one JSON request on stdin, JSON lines out.
"""Fixed owner-only node operations. No browser-provided shell, URL, or path."""
import fcntl
from concurrent.futures import ThreadPoolExecutor
import base64
import csv
import hashlib
import json
import math
import os
import shutil
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import threading
import time

PRINT_LOCK = threading.Lock()


def run(args, timeout=8):
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               stdin=subprocess.DEVNULL)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    output, deadline = bytearray(), time.monotonic()+timeout
    try:
        while selector.get_map():
            if time.monotonic() >= deadline:
                raise RuntimeError('Operation timed out.')
            for key, _ in selector.select(min(.2, max(0, deadline-time.monotonic()))):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                output.extend(chunk)
                if len(output) > 256000:
                    raise RuntimeError('Operation output exceeded its limit.')
        process.wait(timeout=max(.1, deadline-time.monotonic()))
        if process.returncode:
            raise RuntimeError('Node operation failed.')
        return output.decode('utf-8').strip()
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
        process.stdout.close()


def emit(value):
    with PRINT_LOCK:
        try:
            print(json.dumps(value, allow_nan=False), flush=True)
        except (BrokenPipeError, OSError):
            os._exit(0)


def power_summary():
    def read(name):
        file = Path('/sys/power')/name
        return file.read_text().strip() if file.exists() else ''
    return {'sleepModes': read('mem_sleep').replace('[', '').replace(']', '').split(),
            'hibernateAvailable': 'disk' in read('state').split(),
            'remoteWakeVerified': False}


def network_summary():
    up, configured = 0, 0
    for interface in json.loads(run(['ip', '-j', 'addr', 'show'])):
        name = interface.get('ifname', '')
        if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,64}', name):
            continue
        try:
            speed = int((Path('/sys/class/net')/name/'speed').read_text().strip())
        except (OSError, ValueError):
            continue
        if speed >= 100000 and interface.get('operstate') == 'UP':
            up += 1
            if any(a.get('family') == 'inet' for a in interface.get('addr_info', [])):
                configured += 1
    return {'highSpeedLinksUp': up, 'highSpeedLinksConfigured': configured,
            'controlNetwork': 'Tailscale', 'inferenceFabricVerified': False}


def status():
    """Report independent subsystem failures without calling a reachable node offline."""
    issues=[]
    def probe(name, fn, fallback=None):
        try:return fn()
        except Exception:
            issues.append({'name':name,'message':name+' status is unavailable.'})
            return fallback
    def memory_values():
        values={line.split(':')[0]:int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()
                if line.startswith(('MemTotal:', 'MemAvailable:'))}
        return round(values['MemTotal']/1048576,1),round(values['MemAvailable']/1048576,1)
    def gpu_values():
        values=run(['nvidia-smi','--query-gpu=name,utilization.gpu,temperature.gpu','--format=csv,noheader']).split(',')
        return values[0].strip(),float(values[1].strip().rstrip('% ')),float(values[2].strip())
    def gpu_power():
        value=float(run(['nvidia-smi','--query-gpu=power.draw','--format=csv,noheader,nounits']).splitlines()[0])
        if not math.isfinite(value) or value < 0:
            raise ValueError('GPU power is unavailable.')
        return value
    # Independent probes run together so a broken subsystem does not consume the
    # whole node-status timeout before the healthy subsystems can report.
    requests={
        'gpuPower':('GPU power',gpu_power,None),
        'memory':('Memory',memory_values,(None,None)),
        'gpu':('GPU',gpu_values,(None,None,None)),
        'containers':('Docker',lambda:run(['docker','ps','-a','--format','{{.Names}}\t{{.State}}']).splitlines(),None),
        'network':('Network',network_summary,None),
        'disk':('Storage',lambda:round(shutil.disk_usage(Path.home()).free/2**30,1),None),
    }
    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        pending={key:pool.submit(probe,*args) for key,args in requests.items()}
        values={key:future.result() for key,future in pending.items()}
    memory,gpu,containers=values['memory'],values['gpu'],values['containers']
    load=probe('System load',lambda:os.getloadavg()[0])
    return {'gpuPowerWatts':values['gpuPower'],'gpu':gpu[0],'gpuUtilization':gpu[1],'temperature':gpu[2],
            'memoryTotalGiB':memory[0],'memoryFreeGiB':memory[1],
            'uptimeSeconds':probe('Uptime',lambda:int(float(Path('/proc/uptime').read_text().split()[0]))),
            # Linux load includes runnable and uninterruptible tasks. It is
            # not a CPU utilization percentage.
            'load':load,'load1Minute':load,'cpuLogicalCount':os.cpu_count(),
            'runningContainers':None if containers is None else [line.split('\t')[0] for line in containers if line.endswith('\trunning')][:40],
            'dockerAccessible':containers is not None,
            'diskFreeGiB':values['disk'],
            'network':values['network'],
            'power':probe('Power',power_summary),'issues':issues,'checkedAt':checked_at()}


def checked_at():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())


def diagnostics():
    report=status();checks=[]
    def check(name,ok,message):checks.append({'name':name,'ok':bool(ok),'message':message})
    try:
        import socket
        hostname=socket.gethostname()
        check('Connection',True,'Worker responded on '+hostname+'.')
    except Exception:check('Connection',True,'The node worker responded.')
    check('GPU',report['gpu'] is not None,report['gpu'] or 'GPU telemetry unavailable; inspect the driver and nvidia-smi.')
    check('Memory',report['memoryFreeGiB'] is not None,
          str(report['memoryFreeGiB'])+' GiB available of '+str(report['memoryTotalGiB'])+' GiB.' if report['memoryFreeGiB'] is not None else 'Memory telemetry unavailable.')
    check('Docker',report['dockerAccessible'],'Container service accessible.' if report['dockerAccessible'] else 'Container service unavailable to this account.')
    network=report['network']
    check('Network',network is not None,
          str(network['highSpeedLinksUp'])+' high-speed links up; '+str(network['highSpeedLinksConfigured'])+' have IP addresses. Link status does not measure bandwidth.' if network else 'Network inspection unavailable.')
    free=report['diskFreeGiB']
    check('Storage',free is not None and free>=10,str(free)+' GiB free.' if free is not None else 'Storage inspection unavailable.')
    for issue in report['issues']:
        if issue['name'] not in {c['name'] for c in checks}:check(issue['name'],False,issue['message'])
    return {'checks':checks,'checkedAt':checked_at()}


def bounded_logs(args,timeout=10,limit=32768):
    """Read a fixed log command, including stderr, with bounded time and output."""
    process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL)
    selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
    result=bytearray();deadline=time.monotonic()+timeout;truncated=False
    try:
        while selector.get_map():
            if time.monotonic()>=deadline:raise ValueError('Log request timed out. Try again shortly.')
            for key,_ in selector.select(min(.2,max(0,deadline-time.monotonic()))):
                chunk=os.read(key.fileobj.fileno(),65536)
                if not chunk:selector.unregister(key.fileobj);continue
                # Keep the newest output: the end of a log is where a failure shows.
                result.extend(chunk)
                if len(result)>limit:del result[:len(result)-limit];truncated=True
        process.wait(timeout=max(.1,deadline-time.monotonic()))
        return result.decode('utf-8','ignore'),truncated,process.returncode==0
    finally:
        selector.close()
        if process.poll() is None:process.kill();process.wait(timeout=3)
        process.stdout.close()


def redact_logs(text,truncated=False):
    # Accept JSON/Python quoted keys and escaped quoted values as well as plain
    # key=value lines. A value cut off by the output cap is redacted to line end.
    quoted_value=r'"(?:\\.|[^"\\\r\n])*(?:"|(?=\r?$))|\'(?:\\.|[^\'\\\r\n])*(?:\'|(?=\r?$))'
    text=re.sub(r'(?im)(["\']?authorization["\']?\s*[:=]\s*)('+quoted_value+r')',r'\1"[REDACTED]"',text)
    text=re.sub(r'(?i)(["\']?authorization["\']?\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;"\'}]+',r'\1[REDACTED]',text)
    text=re.sub(r'(?im)((?<![\w])(?:["\']?[A-Z_]*(?:API_KEY|AUTH_TOKEN|PASSWORD|SECRET)["\']?)\s*[:=]\s*)('+quoted_value+r'|[^\s,;}]+)',r'\1"[REDACTED]"',text)
    encoded=text.encode('utf-8')
    if len(encoded)>32768:text=encoded[-32768:].decode('utf-8','ignore');truncated=True
    return text,truncated


def service_logs(config):
    service=config.get('service')
    units={'console':'spark-console-api.service'}
    if service=='sparkie':args=['docker','logs','--tail','100','sparkie-main']
    elif isinstance(service,str) and service in units:args=['journalctl','--user','-u',units[service],'-n','100','--no-pager','--output=short-iso']
    else:raise ValueError('Choose console or sparkie logs.')
    text,truncated,ok=bounded_logs(args)
    text,truncated=redact_logs(text,truncated)
    return {'service':service,'text':text,'truncated':truncated,'ok':ok,'checkedAt':checked_at()}


def container_protection(name,image):
    """Protect the access path from routine service controls."""
    protected=r'(^|[/_.-])(spark[-_]portal|tailscale|tailscaled|code[-_]server|portal[-_]editor|portainer)([/_.:-]|$)'
    if re.search(protected,name,re.I) or re.search(protected,image,re.I):
        return 'Portal and access infrastructure is managed from its dedicated controls.'
    return None


def inspect_container(container_id):
    if not isinstance(container_id,str) or not re.fullmatch('[a-f0-9]{64}',container_id):
        raise ValueError('Choose a listed container with its full ID.')
    # Only the ID and name. Environment, commands, and credentials are
    # neither requested nor returned to the browser.
    template='{"Id":{{json .Id}},"Name":{{json .Name}}}'
    try:info=json.loads(run(['docker','inspect','--type','container','--format',template,container_id]))
    except Exception:raise ValueError('Container no longer exists or Docker is unavailable. Refresh workloads.') from None
    if not isinstance(info,dict) or info.get('Id')!=container_id:
        raise ValueError('Container identity changed. Refresh workloads before continuing.')
    if not isinstance(info.get('Name'),str):
        raise ValueError('Container details are unavailable. Refresh workloads.')
    info['Name']=info['Name'].lstrip('/')
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,255}',info['Name']):
        raise ValueError('Container name is unavailable.')
    return info


def container_logs(config):
    info=inspect_container(config.get('containerId'))
    text,truncated,ok=bounded_logs(['docker','logs','--tail','100',info['Id']])
    text,truncated=redact_logs(text,truncated)
    return {'containerId':info['Id'],'name':info['Name'],'text':text,'truncated':truncated,
            'ok':ok,'checkedAt':checked_at()}


def workloads():
    """Bounded owner inventory; no process arguments, environment, or container inspect."""
    limits={'containers':60,'processes':50,'gpuProcesses':60,'services':60}
    result={'checkedAt':checked_at(),**{key:None for key in limits},'issues':[],
            'limits':limits,'truncated':{key:False for key in limits},
            'processScope':'Top processes by lifetime-average CPU; command names only.',
            'serviceScope':'Running services belonging to the portal owner.'}
    probes={
        'containers':['docker','ps','--all','--no-trunc','--format','{{json .}}'],
        'processes':['ps','-eo','pid,user,pcpu,pmem,rss,comm','--sort=-pcpu'],
        'gpuProcesses':['nvidia-smi','--query-compute-apps=pid,process_name,used_memory','--format=csv,noheader,nounits'],
        'services':['systemctl','--user','list-units','--type=service','--state=running','--no-legend','--no-pager','--plain'],
    }
    def display(value,limit=256):
        if not isinstance(value,str):raise ValueError('Invalid inventory field.')
        return re.sub(r'[\x00-\x1f\x7f]', '', value)[:limit]
    def probe(key,args):
        try:
            out=run(args,timeout=10)
            if key=='containers':
                raw=[json.loads(line) for line in out.splitlines() if line]
                rows=[]
                for r in raw:
                    row={k:display(r.get(k,''),1024 if k=='Ports' else 256) for k in ['ID','Names','Image','State','Status','Ports']}
                    if not re.fullmatch('[a-f0-9]{64}',row['ID']):raise ValueError('Container identity unavailable.')
                    reason=container_protection(row['Names'],row['Image'])
                    rows.append({**row,'protected':reason is not None,'protectionReason':reason})
                result['containerCounts']={'running':sum(r['State']=='running' for r in rows),'total':len(rows)}
            elif key=='processes':
                rows=[]
                for line in out.splitlines()[1:]:
                    parts=line.split(None,5)
                    if len(parts)!=6 or not parts[0].isdigit():raise ValueError('Invalid process inventory.')
                    rows.append(dict(zip(['pid','user','cpu','memory','rssKiB','name'],[display(p) for p in parts])))
            elif key=='gpuProcesses':
                rows=[]
                for parts in csv.reader(out.splitlines()):
                    if not parts:continue
                    if len(parts)!=3 or not parts[0].strip().isdigit():raise ValueError('GPU process inventory unavailable.')
                    rows.append({'pid':parts[0].strip(),'name':display(Path(parts[1].strip()).name),'memoryMiB':display(parts[2].strip())})
            else:
                rows=[display(line.split(None,4)[0]) for line in out.splitlines() if line.strip()]
            return rows[:limits[key]],len(rows)>limits[key]
        except Exception:
            return None,False
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending={key:pool.submit(probe,key,args) for key,args in probes.items()}
        for key,future in pending.items():
            result[key],result['truncated'][key]=future.result()
            if result[key] is None:result['issues'].append(key+' unavailable; do not assume empty.')
    result.setdefault('containerCounts',None)
    return result


WORKSPACE_STORAGE = Path.home()/'.local/share/spark-portal/workspaces'
FILE_LIMIT = 256*1024


class WorkspaceConflict(ValueError):
    pass


def workspace_files(config):
    """Bounded file operations in the Spark's shared folder: list, read, write. Nothing is deleted, renamed or made a
    folder here."""
    operation = config.get('operation')
    if operation not in ('list', 'read', 'write'):
        raise ValueError('Unsupported file operation.')

    def path_parts(value, allow_root=False):
        if (not isinstance(value, str) or len(value)>1000 or value.startswith('/') or
                '\\' in value or any(ord(c)<32 for c in value) or
                (value and any(p in ('', '.', '..') for p in value.split('/')))):
            raise ValueError('Choose a relative path inside the workspace.')
        pieces = value.split('/') if value else []
        if any(p.startswith('.portal-') for p in pieces):
            raise ValueError('That filename is reserved for workspace operations.')
        if not pieces and not allow_root:
            raise ValueError('Choose a file or folder name.')
        return pieces

    relative = config.get('path', '')
    parts = path_parts(relative, allow_root=operation=='list')
    offset, limit = config.get('offset', 0), config.get('limit', 250)
    if type(offset) is not int or not 0<=offset<=10000 or type(limit) is not int or not 1<=limit<=250:
        raise ValueError('Choose a valid folder page.')
    if operation!='list' and ('offset' in config or 'limit' in config):
        raise ValueError('Folder pages are only supported for listing.')
    if config.get('workspaceScope')!='shared':
        raise ValueError('Invalid workspace scope.')
    workspace = WORKSPACE_STORAGE/'shared'
    for directory in reversed([workspace, *workspace.parents]):
        if directory==Path.home() or Path.home() in directory.parents:
            directory.mkdir(mode=0o700, exist_ok=True)
            info=directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid():
                raise ValueError('Unsafe managed workspace directory.')
    descriptors=[]
    try:
        root=os.open(workspace, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        descriptors.append(root)
        def directory_fd(pieces):
            current=root
            for part in pieces:
                current=os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=current)
                descriptors.append(current)
            return current
        fd=directory_fd(parts if operation=='list' else parts[:-1])
        def folder_revision(info):
            value=f'directory:{info.st_dev}:{info.st_ino}:{info.st_mtime_ns}:{info.st_ctime_ns}'
            return hashlib.sha256(value.encode()).hexdigest()
        if operation=='list':
            entries=[];capped=False
            scan_limit=1000
            with os.scandir(fd) as items:
                for entry in items:
                    if entry.name.startswith('.portal-'):continue
                    if len(entries)>=scan_limit:
                        capped=True;break
                    try:info=entry.stat(follow_symlinks=False)
                    except FileNotFoundError:continue
                    kind='folder' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'link' if stat.S_ISLNK(info.st_mode) else 'special'
                    entries.append({'name':entry.name,'kind':kind,'size':info.st_size,'modifiedAt':info.st_mtime,
                                    'revision':folder_revision(info) if kind=='folder' else None})
            entries.sort(key=lambda x:(x['kind']!='folder', x['name'].casefold(), x['name']))
            total=len(entries);page=entries[offset:offset+limit]
            next_offset=offset+limit if offset+limit<total else None
            return {'path':relative,'entries':page,'offset':offset,'limit':limit,'total':total,
                    'totalExact':not capped,'nextOffset':next_offset,'truncated':capped or next_offset is not None,
                    'maxFileBytes':FILE_LIMIT}
        name=parts[-1]
        def read_existing(parent=fd, leaf=name):
            file=os.open(leaf, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK, dir_fd=parent)
            try:
                info=os.fstat(file)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:
                    raise ValueError('Only regular, unlinked workspace files can be opened.')
                if info.st_size>FILE_LIMIT:
                    raise ValueError('This file is larger than 256 KiB.')
                data=bytearray()
                while len(data)<=FILE_LIMIT:
                    chunk=os.read(file, min(65536, FILE_LIMIT+1-len(data)))
                    if not chunk:break
                    data.extend(chunk)
                if len(data)>FILE_LIMIT:raise ValueError('The file grew beyond the small-file limit.')
                return bytes(data),info
            finally:os.close(file)
        if operation=='read':
            data,info=read_existing()
            return {'path':relative,'data':base64.b64encode(data).decode(),'revision':hashlib.sha256(data).hexdigest(),'size':len(data)}
        lockfd=os.open('.portal-files.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600, dir_fd=root)
        descriptors.append(lockfd);fcntl.flock(lockfd, fcntl.LOCK_EX|fcntl.LOCK_NB)
        revision=config.get('revision')
        data=None
        if operation=='write':
            encoded=config.get('data')
            if not isinstance(encoded,str) or len(encoded)>350000:raise ValueError('Choose a file up to 256 KiB.')
            try:data=base64.b64decode(encoded,validate=True)
            except Exception:raise ValueError('Invalid file data.') from None
            if len(data)>FILE_LIMIT:raise ValueError('Choose a file up to 256 KiB.')
            if revision is not None and (not isinstance(revision,str) or not re.fullmatch('[a-f0-9]{64}',revision)):
                raise ValueError('Reload the file before saving.')
        total=0;count=0
        for parent,folders,files in os.walk(workspace,followlinks=False):
            for item in folders+files:
                if item.startswith('.portal-'):continue
                info=(Path(parent)/item).lstat();count+=1
                if stat.S_ISREG(info.st_mode):total+=info.st_size
                if count>1000:raise ValueError('Workspace entry limit reached. Delete unused items before adding more.')
        existing=(workspace/relative).exists()
        previous=(workspace/relative).lstat().st_size if existing and operation=='write' else 0
        if (count>=1000 and not existing) or total-previous+len(data or b'')>64*1024*1024:
            raise ValueError('Workspace limit reached: 64 MiB and 1,000 entries per space on each machine.')
        try:old,info=read_existing()
        except FileNotFoundError:old,info=None,None
        if (old is not None and revision!=hashlib.sha256(old).hexdigest()) or (old is None and revision is not None):
            raise WorkspaceConflict('This file changed or already exists. Reload it before saving; your edits have not been written.')
        temporary='.portal-write-'+os.urandom(12).hex()
        out=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,info.st_mode&0o777 if info else 0o600,dir_fd=fd)
        try:
            with os.fdopen(out,'wb') as stream:
                stream.write(data);stream.flush();os.fsync(stream.fileno())
            if old is None:os.link(temporary,name,src_dir_fd=fd,dst_dir_fd=fd,follow_symlinks=False)
            else:
                current,current_info=read_existing()
                if current_info.st_ino!=info.st_ino or hashlib.sha256(current).hexdigest()!=revision:
                    raise WorkspaceConflict('This file changed while saving. Reload it before trying again.')
                os.replace(temporary,name,src_dir_fd=fd,dst_dir_fd=fd)
            os.fsync(fd)
        finally:
            try:os.unlink(temporary,dir_fd=fd)
            except FileNotFoundError:pass
        return {'saved':True,'path':relative,'revision':hashlib.sha256(data).hexdigest(),'size':len(data)}
    except WorkspaceConflict:raise
    except FileExistsError:raise WorkspaceConflict('That name already exists. Choose another name.') from None
    except FileNotFoundError:raise ValueError('File or folder not found. Refresh the folder and try again.') from None
    except BlockingIOError:raise ValueError('Another file operation is in progress. Try again shortly.') from None
    except OSError:raise ValueError('This path is unavailable. Links and files outside the workspace are not opened here.') from None
    finally:
        for descriptor in reversed(descriptors):os.close(descriptor)

def main(config):
    if not isinstance(config, dict):
        raise ValueError('Expected an operation object.')
    action = config.get('action')
    allowed = {'workspace-files': {'action','operation','path','data','revision','offset','limit','workspaceScope'},
               'status': {'action'}, 'diagnostics': {'action'}, 'workloads': {'action'}, 'logs': {'action','service'},
               'container-logs': {'action','containerId'}}
    if not isinstance(action, str) or action not in allowed or set(config)-allowed[action]:
        raise ValueError('Unsupported operation settings.')
    if action == 'workspace-files':
        return workspace_files(config)
    if action == 'workloads':
        return workloads()
    if action == 'status':
        return status()
    if action == 'diagnostics':
        return diagnostics()
    if action == 'logs':
        return service_logs(config)
    if action == 'container-logs':
        return container_logs(config)
    raise ValueError('Unsupported operation settings.')

if __name__ == '__main__':
    os.umask(0o077)
    signal.alarm(200)
    stopped = threading.Event()
    def heartbeat():
        while not stopped.wait(2):
            emit({'type': 'heartbeat'})
    threading.Thread(target=heartbeat, daemon=True).start()
    try:
        raw = sys.stdin.read(400001)
        if len(raw) > 400000:
            raise ValueError('Operation input exceeded its limit.')
        emit({'type': 'result', 'result': main(json.loads(raw))})
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else 'The node could not complete this operation ('+type(error).__name__+').' 
        emit({'type': 'error', 'error': message[:300], 'code':'conflict' if isinstance(error,WorkspaceConflict) else None})
        sys.exit(1)
    finally:
        stopped.set()
