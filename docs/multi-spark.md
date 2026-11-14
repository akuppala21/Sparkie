# One model across Sparks

**Status:** built (2026-11-04), not yet run on the real Sparks. Deploy offers every pair whose cable tests good,
next to single Sparks; each pair on Home has **Start a model**. It follows "How serving across Sparks will
work" below: two Sparks only, vLLM only. The first Spark answers on its Tailscale address, and stopping either part stops
both. Tested on the stand-in Sparks: plan, start, failure with both logs, stop, and moving a model between one Spark and
a pair. Before the first real run, the vLLM image needs checking for DGX Spark (see Recipes research).

## What's already in the console (read-only)

- **Each Spark → Checks → Direct cables.** For every Spark it lists the ConnectX (QSFP) links: up or
  down, speed, addresses and MTU. **Test connections** pings each pair over the cable at full packet size with fragmentation
  off, then at normal size, so it can tell "connected" from "packet size mismatch" and "not answering".
  It reads `/sys/class/net` and `ip -4 addr` and runs `ping`. It changes nothing.
  Service route: `GET /console/api/fabric` (add `?check=1` for the ping test). Owner only.
- **Spark cards** show a chip for each running request pool or compute cluster the Spark belongs to.

## Your network today (read-only scan, 2026-11-03)

Spark 2, 3 and 4 are already cabled as a **3-way mesh**. Each pair has its own cable, every link is up at 200 Gb/s, and
the MTU is 1500 on every link. Both ends match, and 1500 is NVIDIA's setting for a mesh. Each cable carries two subnets,
one per twin:

| Pair | Subnets | Ports |
|---|---|---|
| Spark 2 ↔ Spark 3 | 10.100.188.0/24, 10.100.189.0/24 | Spark 2 port 1 ↔ Spark 3 port 0 |
| Spark 3 ↔ Spark 4 | 10.100.186.0/24, 10.100.187.0/24 | Spark 3 port 1 ↔ Spark 4 port 1 |
| Spark 2 ↔ Spark 4 | 10.100.184.0/24, 10.100.185.0/24 | Spark 2 port 0 ↔ Spark 4 port 0 |

The pairs come from shared subnets. **Test connections** confirms them with pings; it hasn't been run yet.
Spark 1 (akspark) was unplugged, so it isn't in the scan.

What that means for serving:
- **Two Sparks** (e.g. Spark 2 + 3): use that pair's cable. For Spark 2 as head that's `HEAD_IP=10.100.188.1`,
  `ETH_IF=enp1s0f1np1`, `IB_IF=rocep1s0f1,roceP2p1s0f1`.
- **Three Sparks:** every Spark talks to each peer on a different port.
  - The community mesh settings use all four RoCE devices with `NCCL_IB_SUBNET_AWARE_ROUTING=1` and
    `NCCL_IB_MERGE_NICS=0`. That's from the community docs, not NVIDIA's; verify it before relying on it.
  - Tensor parallel also needs the model's attention-head count to divide by the number of Sparks, and 3 rarely does.
    So 2 (or 4) is the natural size.

## Adding akspark as the fourth Spark

akspark is the console's **Spark 1**: Tailscale name `akspark`, 100.119.233.101; the portal's SSH config calls it `akspark1`.
It's already in the Spark list. When it's plugged in and on Tailscale, it shows up in the console on its own: its card,
live metrics, library, deploys and the readiness check.

**When it's back on:**
- Re-run `bash spark-console/deploy/host-on-portal.sh`. Its SSH check should say `spark1: ok`. If it says it needs a password,
  copy Spark 2's key to it once (on Spark 2: `ssh-copy-id akuppala@100.119.233.101`).
- Open a Spark → Checks → Direct cables, and check its links.

**Cabling.** Each Spark has two QSFP ports, and the 3-way mesh already uses both ports on Spark 2, 3 and 4. So akspark can't
join without re-cabling. NVIDIA's layouts for four Sparks are a **ring** or a **switch**:

| | Ring (recommended) | Switch |
|---|---|---|
| Hardware | 4 cables: the 3 you have plus 1 more | A 200 Gb/s QSFP switch, 1 cable per Spark |
| Change | Move the Spark 2 ↔ Spark 4 cable and add one: Spark 2 – 3 – 4 – akspark – Spark 2 | Every Spark goes to the switch |
| One model on all 4 | Yes | Yes |
| One model on 2 | Neighbors only: 2+3, 3+4, 4+akspark, akspark+2 | Any pair |
| Two copies on 2+2 | Yes: 2+3 and 4+akspark are both neighbor pairs | Yes |

NVIDIA's [cable page](https://build.nvidia.com/spark/connect-multiple-sparks/cable-devices.md) gives the exact port order for a
ring. After re-cabling, re-run NVIDIA's setup helper for all four (`--topology ring`, MTU 1500). That replaces today's mesh
addresses, so the per-pair values above change.

Do this after the benchmarks: `netplan apply` briefly interrupts networking on every Spark.

**Four Sparks serving one model** is community-tested only, not NVIDIA's.
- In a ring, Spark 3 and akspark (and Spark 2 and 4) have no cable between them. So vLLM's startup handshake must run over
  a network all four share (LAN or Tailscale).
- NCCL needs the community's subnet-aware routing (`NCCL_IB_SUBNET_AWARE_ROUTING=1`).
- Before serving anything, prove it with NVIDIA's four-node NCCL test (build.nvidia.com/spark/nccl, four nodes).

The console's readiness check works the same in a ring. Neighbors show **Connected**; the two opposite pairs show
**Not cabled together**, which is expected.

## How serving across Sparks will work

We'll follow NVIDIA's own two-Spark method ([vllm-cluster, advanced](https://build.nvidia.com/spark/vllm-cluster/advanced.md)):
native vLLM multi-node with one tensor-parallel rank per Spark. It doesn't need Ray.
The console service already reaches every Spark over SSH from Spark 2, so it can start each Spark's part itself.
That means the Sparks don't need SSH to each other. The community `launch-cluster.sh` does need that, and we won't use it.

### What "Deploy across Sparks" will do

1. **Plan.** You pick the model and 2 Sparks. 3–4 Sparks only have community recipes, not NVIDIA's.
   - The first Spark is the **head**: it serves the API. The default head is Spark 2, since it's always on.
   - The plan lists every container in the way on every member, with the same **Keep running** checkboxes as single-Spark
     deploys. Containers labeled `spark.protect=true` are never stopped.
2. **Check.** Before anything stops, the plan runs:
   - The readiness test. The head must pass full-size packets with every worker.
   - Model on every member: missing copies come from the library, the same way single-Spark deploys copy today.
   - Pinned image present on every member: pulled if missing.
3. **Start.** On each member it runs `docker run -d` with NVIDIA's flags, head first, then the workers. NVIDIA: "the
   distributed startup waits for both ranks".
4. **Health.** It waits for `http://<head>:8000/health`, then `/v1/models`. If any member fails, it collects every member's
   last log lines, stops all members and reports. NVIDIA warns that a failed worker can block the head.
5. **Run and stop.** It shows as one workload, e.g. "Qwen 3.8 27B on Spark 2 + Spark 3". **Stop** runs `docker stop` on every member.

### Per-Spark values the service works out from the readiness data

| Value | Where it comes from |
|---|---|
| `HEAD_IP` | The head's address on the subnet it shares with the workers |
| `ETH_IF` | The local ConnectX netdev holding the address on that subnet, e.g. `enp1s0f1np1` |
| `IB_IF` | The RoCE devices of the cabled twins, e.g. `rocep1s0f1,roceP2p1s0f1` |
| `MASTER_PORT` | `29501` |

### Container command (one per Spark)

```bash
docker run -d --name spark-console-<deploy>-r<rank> \
  --label spark.console=1 --label spark.console.deploy=<deploy> --label spark.console.rank=<rank> \
  --privileged --gpus all --ipc host --network host --shm-size=16g \
  --ulimit nofile=1048576:1048576 --ulimit memlock=-1 --ulimit stack=67108864 \
  -v ~/models/<model>:/model:ro \
  -e NCCL_SOCKET_IFNAME=$ETH_IF -e GLOO_SOCKET_IFNAME=$ETH_IF -e UCX_NET_DEVICES=$ETH_IF -e TP_SOCKET_IFNAME=$ETH_IF \
  -e NCCL_IB_HCA=$IB_IF -e NCCL_IB_DISABLE=0 -e NCCL_IGNORE_CPU_AFFINITY=1 \
  <recipe env, e.g. VLLM_ENABLE_ROCE_ALLREDUCE=1> \
  <image> vllm serve /model \
    --tensor-parallel-size 2 --nnodes 2 --master-addr $HEAD_IP --master-port 29501 \
    --node-rank 0                # head; workers use: --node-rank 1 --headless
    --host <head Tailscale IP> --port 8000 <recipe args>
```

With `--network host`, vLLM listens on the host's own interfaces. It binds to the head's Tailscale address, not `0.0.0.0`,
so the API is reachable the same way single-Spark deploys are and isn't exposed on the LAN or the cable network.

### Recipe format

Each recipe in `service/catalog.json` (and in a model folder's `spark.json`) gets an optional `cluster` block. Single-Spark
recipes stay as they are.

```json
{
  "title": "Qwen 3.8 27B NVFP4 + DFlash2",
  "engine": "vllm",
  "image": "eugr/spark-vllm-b12x:nightly-20261015",
  "args": ["--kv-cache-dtype", "fp8", "--enable-prefix-caching", "--reasoning-parser", "qwen3"],
  "cluster": { "sparks": 2, "env": { "VLLM_ENABLE_ROCE_ALLREDUCE": "1", "NCCL_IGNORE_CPU_AFFINITY": "1" } }
}
```

The community and NVIDIA YAML recipes map directly onto this:
- `container` → `image`
- `defaults.tensor_parallel` → `cluster.sparks`
- `env` → `cluster.env`
- the `command` flags → `args`, with `{placeholders}` filled from `defaults`

The console fills in the multi-node flags itself (`--nnodes`, `--node-rank`, `--master-addr`, `--headless`), so recipes
leave them out. The community launcher does the same.

## Decisions for when the benchmarks finish

- **Recipe:** which Qwen model, image tag, arguments and environment. That becomes one recipe entry.
  - Pin the image tag: the community `:latest` tags move.
- **Sparks:** all four with akspark, two copies on 2+2, or one pair. NVIDIA documents 2 Sparks; 3–4 are community-tested only.
- **Cabling:** ring or switch for akspark (see above). Re-cable after the benchmarks.

## Network setup (done once, outside the console)

Spark 2–4 are already set up this way. The console reads the network and never changes it. Setting it up means:
- writing netplan and running `netplan apply`, which briefly interrupts networking;
- one `/24` per cable twin (never the same subnet on both twins);
- the same MTU on both ends.

NVIDIA's [connect-multiple-sparks](https://build.nvidia.com/spark/connect-multiple-sparks.md) helper (`setup-cluster.sh`) or
NVIDIA Sync does this. On MTU, NVIDIA's examples use 9000 for two Sparks on a direct cable and 1500 for ring, mesh and switch
layouts. Either works as long as both ends match, and the readiness test catches a mismatch. Run the setup while the
Sparks are idle, not during the benchmarks.

## What the community found (NVIDIA forums, Nov 2026; not yet tried here)

- **When two Sparks help:** dense or large-active models get about 1.35–1.7× one-user speed on two Sparks (Gemma 4 31B,
  Qwen3.8 27B with SGLang + DFlash2 about 52 → 80 tokens/s on code, gpt-oss-120b about 59 → 81). Small-active MoE models
  gain little for one user (Qwen3.8 Flash-Next: the best one-Spark setup beats every two-Spark one), but pairs still give
  more total throughput and a much bigger KV cache.
- **Three and four Sparks:** a cable triangle of three works (DeepSeek V4.1 Flash, TP=3). For one user, four Sparks were
  slower than two on Qwen3.8 Flash-Next, and two separate pairs beat one four-Spark setup on total throughput. So two
  pairs is the better default for four Sparks.
- **Gotchas to check on the first real run:**
  - NCCL must use the cable, not the 1 GbE port (a TP=3 run fell to ~6 tokens/s that way).
  - Several people needed MTU 9000 on the cable interfaces to stop NCCL hanging at warmup; this mesh uses 1500.
  - Docker needs the RDMA devices (`--privileged` covers `/dev/infiniband`), or NCCL falls back to TCP.
  - Don't pin `NCCL_IB_GID_INDEX` (it can change after a link flap). Some models need `NCCL_MIN/MAX_NCHANNELS=4`.
  - Keep the memory share conservative: on unified memory an overcommit can hang the box instead of failing.

## Risks

- A worker that fails to start can hang the head. Health has a deadline, and a failure stops every member.
- Host networking plus `--privileged` gives the container wide access. Only pinned images from the recipe list run this way.
- Two Sparks give one model about twice the memory. Speed depends on the model: each Spark reads half the weights per token,
  but every layer waits on the cable. The benchmarks should compare one-Spark and two-Spark throughput before we pick.
