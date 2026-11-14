#!/usr/bin/env python3
"""Builds service/catalog.json, the Recipes catalog: models → versions (quantizations) → setups (engine, image, flags,
number of Sparks) with the speeds people published.

Inputs are the research files (JSON) gathered on 2026-11-04:
  research-text.json, research-vision-rag.json   models and versions, Hugging Face ids checked
  research-spark.json                            NVIDIA's tested models and live DGX Spark playbooks
  recipes-forums.json, recipes-github.json,      community setups with their numbers and sources
  recipes-reddit-blogs.json

  python3 -I spark-console/tools/build-catalog.py <research dir> spark-console/service/catalog.json

A setup is one-click ("deployable") only when the console can run it as-is and safely: vLLM or SGLang, 1 or 2 Sparks,
a version-pinned image from a known registry, and no flag that loads plugins, reads host paths or calls out. Everything
else stays listed with its numbers and the reason it isn't one-click yet.
"""
import hashlib
import json
import re
import shlex
import sys
from pathlib import Path

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
load = lambda name: json.loads((SRC / name).read_text())

QUANT = r"(nvfp4|mxfp4|fp8(-dynamic)?|fp4(-local)?|bf16|fp16|awq|gptq|int4(-autoround)?|int8|w4a16|w8a8|gguf|exl3[\w.-]*|autoround|4bit|8bit|full|dspark|dflash\d?)"
SIZE = r"(\d+(\.\d+)?b(-a\d+(\.\d+)?b)?|a\d+(\.\d+)?b)"


NOISE = r"(dgx-spark|spark|2x-dgx-spark[\w.-]*|tensorfold[\w.-]*|[\d.]+bpw|int4-int8mix|w4a16-gptq|autoround-[\w.-]+|longctx|mtp(-xs)?|bf16-lmhead|lmhead|exl3|gx10|twinspark)"


def base(name):
    """A model's family name without publisher, quantization, packaging or instruct suffixes:
    nvidia/Qwen3.8-27B-NVFP4 → qwen3.8-27b; "Qwen3.8-27B (dense)" → qwen3.8-27b."""
    s = re.sub(r"\(.*?\)", "", str(name or "")).strip().split("/")[-1].lower().replace("_", "-").replace(" ", "-")
    s = re.sub(r"-+", "-", s).strip("-")
    for _ in range(6):
        s = re.sub(rf"[-.]{QUANT}$", "", s)
        s = re.sub(rf"[-.]{NOISE}$", "", s)
        s = re.sub(r"[-.](instruct|it|chat|hf)$", "", s)
    return s


def bare(name):
    """Also without size tags, for loose matching: qwen3.8-flash-next-125b-a5b → qwen3.8-flash-next."""
    s = base(name)
    for _ in range(3):
        s = re.sub(rf"-{SIZE}$", "", s)
    return s


# Models: text and vision/RAG research, merged when the same model appears in both.
models, by_key = [], {}
for name in ("research-text.json", "research-vision-rag.json"):
    for m in load(name):
        keys = {base(v["repo"]) for v in m["variants"]} | {base(m["title"])}
        found = next((by_key[k] for k in keys if k in by_key), None)
        if found:
            found["categories"] = sorted(set(found["categories"]) | set(m["categories"]))
            have = {v["repo"] for v in found["variants"]}
            found["variants"] += [v for v in m["variants"] if v["repo"] not in have]
        else:
            found = {**m, "variants": list(m["variants"])}
            models.append(found)
        for k in keys:
            by_key.setdefault(k, found)
bare_key = {}
for m in models:
    for k in {bare(v["repo"]) for v in m["variants"]} | {bare(m["title"])}:
        bare_key.setdefault(k, m)
        bare_key.setdefault(re.sub(r"-\d{4}$", "", k), m)   # "deepseek-v4-flash-0731" also answers to "deepseek-v4-flash"


def model_for(repo, title):
    for k in (base(repo), base(title)):
        if k and k in by_key:
            return by_key[k]
    for k in (bare(repo), bare(title)):
        if k and k in bare_key:
            return bare_key[k]
        if k and re.sub(r"-\d{4}$", "", k) in bare_key:
            return bare_key[re.sub(r"-\d{4}$", "", k)]
    return None


# Families the model research left out (most need 3–4 Sparks) still get an entry when people published setups for them.
# Uncensored / abliterated / "heretic" fine-tunes stay out.
SKIP = re.compile(r"uncensored|abliterat|heretic", re.I)


def new_model(r):
    title = re.sub(r"\s*\(.*?\)", "", r.get("modelTitle") or "").strip() or str(r.get("modelRepo") or "").split("/")[-1]
    m = {"family": title.split()[0].split("-")[0], "title": title, "released": None, "categories": ["chat", "big"],
         "about": None, "params": None, "contextK": None, "license": None, "rank": 3, "variants": [], "setups": [], "community": True}
    models.append(m)
    for k in {base(r.get("modelRepo")), base(title)} - {""}:
        by_key.setdefault(k, m)
    for k in {bare(r.get("modelRepo")), bare(title)} - {""}:
        bare_key.setdefault(k, m)
        bare_key.setdefault(re.sub(r"-\d{4}$", "", k), m)
    return m


# Flags the console sets itself, and flags it won't run from a recipe.
OWN = {"--model", "--model-path", "--host", "--port", "--served-model-name", "--tensor-parallel-size", "-tp", "--tp", "--tp-size",
       "--nnodes", "--node-rank", "--master-addr", "--master-port", "--headless", "--dist-init-addr", "--pipeline-parallel-size",
       "--pp", "--pp-size", "--data-parallel-size", "--dp"}
UNSAFE = {"--middleware", "--worker-cls", "--worker-extension-cls", "--otlp-traces-endpoint", "--tool-parser-plugin",
          "--reasoning-parser-plugin", "--download-dir", "--chat-template", "--allowed-local-media-path", "--ssl-keyfile",
          "--ssl-certfile", "--api-key", "--root-path", "--log-config-file", "--logits-processors"}
HEAD = {"serve", "python3", "python", "-m", "sglang.launch_server", "vllm", "sglang", "trtllm-serve", "llama-server"}
BOOL = {"--trust-remote-code", "--enable-prefix-caching", "--enable-auto-tool-choice", "--enforce-eager", "--headless", "--jinja",
        "--disable-log-requests", "--enable-chunked-prefill", "--enable-torch-compile", "--disable-radix-cache", "--enable-expert-parallel"}
ENV_OK = re.compile(r"^(VLLM_|SGLANG_|NCCL_|CUDA_|TORCH|PYTORCH_|TRITON_|FLASHINFER_|TOKENIZERS_|OMP_|HF_HUB_ENABLE_HF_TRANSFER$|SAFETENSORS_FAST_GPU$)")
REGISTRIES = re.compile(r"^(nvcr\.io/nvidia/|vllm/vllm-openai|lmsysorg/sglang|eugr/|ghcr\.io/ggml-org/llama\.cpp)")
PINNED = re.compile(r"^(v?\d[\w.\-+]*|\d{2}\.\d{2}[\w.\-]*|nightly-\d{8}[\w.\-]*|[\w.\-]*\d{8}[\w.\-]*)$")
ENGINES = {"vllm": "vllm", "sglang": "sglang", "trtllm": "trtllm", "tensorrt-llm": "trtllm", "llama.cpp": "llama.cpp",
           "ollama": "ollama", "lmstudio": "lmstudio"}


def flags(args, repo):
    """Split the published flags and keep the ones a recipe may set; report what was dropped."""
    tokens, dropped = [], []
    try:
        for a in args or []:
            tokens += shlex.split(str(a))
    except ValueError:
        return None, ["flags that couldn't be parsed"]
    out, i, stray = [], 0, False
    while i < len(tokens):
        t = tokens[i]
        name = t.split("=", 1)[0]
        takes = "=" not in t and name not in BOOL and i + 1 < len(tokens) and not tokens[i + 1].startswith("-")
        value = tokens[i + 1] if takes else None
        if t.endswith(":") and not t.startswith("-"):  # "docker:" and the like: what follows isn't the engine's flags
            break
        if name in HEAD or t == repo or (not t.startswith("-") and "/" in t):
            i += 1
            continue
        if not t.startswith("-"):  # notes mixed into the command ("MTP", "by", …): it can't run as written
            stray = True
            i += 1
            continue
        if name in OWN:
            i += 2 if takes else 1
            continue
        if name in UNSAFE or (value and value.startswith("/") and name not in ("--speculative-config", "--compilation-config")):
            dropped.append(name)
            i += 2 if takes else 1
            continue
        out.append(t)
        if takes:
            out.append(value)
        i += 2 if takes else 1
    if stray:
        dropped.append("words that aren't flags")
    return out, dropped


def setup_of(r, kind):
    engine = ENGINES.get(str(r.get("engine") or "").lower(), "other")
    image = (r.get("image") or "").strip() or None
    if image and " " in image:
        image = None
    sparks = int(r.get("sparks") or 1)
    args, dropped = flags(r.get("args"), r.get("modelRepo"))
    env = {k: str(v) for k, v in (r.get("env") or {}).items() if ENV_OK.match(str(k)) and not str(v).startswith("<")}
    why = None
    if engine not in ("vllm", "sglang", "trtllm", "llama.cpp"):
        why = f"{engine} isn't one-click yet"
    elif sparks > 2:
        why = f"{sparks}-Spark setups aren't one-click yet"
    elif sparks > 1 and engine not in ("vllm", "sglang"):
        why = f"{engine} across Sparks isn't one-click yet"
    elif not image:
        why = "no container image given"
    elif not REGISTRIES.match(image) or ":" not in image or not PINNED.match(image.rsplit(":", 1)[1]):
        why = "uses an unpinned or community-built image"
    elif args is None:
        why = "its flags couldn't be read"
    elif dropped:
        why = f"uses {', '.join(sorted(set(dropped)))}"
    perf = r.get("perf") or {}
    src = r.get("source") or {}
    sid = hashlib.sha1(json.dumps([r.get("modelRepo"), engine, image, sparks, args, env, src.get("url")], sort_keys=True).encode()).hexdigest()[:10]
    return {
        "id": sid, "repo": r.get("modelRepo"), "quant": r.get("quant"), "engine": engine, "image": image, "sparks": sparks,
        "parallel": r.get("parallel"), "args": args or [], "env": env, "speculative": r.get("speculative"),
        "perf": {k: perf.get(k) for k in ("decodeTokS", "prefillTokS", "aggregateTokS", "concurrency", "context", "tool") if perf.get(k) is not None},
        "source": {"url": src.get("url"), "author": src.get("author"), "date": src.get("date"), "kind": src.get("kind") or kind},
        "credibility": r.get("credibility") or ("high" if kind == "nvidia" else "medium"),
        "notes": (r.get("notes") or r.get("why") or "")[:280], "deployable": why is None, "why": why,
    }


def fit(size_gb):
    if not size_gb:
        return None, None
    need = round(size_gb * 1.15 + 4)
    return need, 1 if need <= 105 else 2 if need <= 210 else 3 if need <= 315 else 4 if need <= 420 else None


# NVIDIA's tested models count as setups too (no numbers, but validated configs).
community = []
for name in ("recipes-forums.json", "recipes-github.json", "recipes-reddit-blogs.json"):
    community += [(r, None) for r in load(name)]
spark = load("research-spark.json")
for t in spark["testedModels"]:
    img = t.get("image")
    community.append(({"modelRepo": t.get("canonicalRepo") or t.get("repo"), "modelTitle": t.get("title"), "engine": t.get("engine"),
                       "image": img, "sparks": t.get("sparks") or 1, "args": [], "notes": t.get("notes"),
                       "source": {"url": None, "author": "NVIDIA", "date": None, "kind": "nvidia"}, "credibility": "high"}, "nvidia"))

unmatched, seen = [], set()
for m in models:
    m["setups"] = []
for r, kind in community:
    if SKIP.search(f"{r.get('modelRepo')} {r.get('modelTitle')}"):
        continue
    m = model_for(r.get("modelRepo"), r.get("modelTitle"))
    if not m and (r.get("perf") or {}).get("decodeTokS") and (r.get("modelRepo") or r.get("modelTitle")):
        m = new_model(r)
    if not m:
        unmatched.append(r)
        continue
    s = setup_of(r, kind or "community")
    if s["id"] in seen:
        continue
    seen.add(s["id"])
    m["setups"].append(s)
    if s["repo"] and s["repo"] not in {v["repo"] for v in m["variants"]} and "/" in s["repo"]:
        m["variants"].append({"repo": s["repo"], "quant": s["quant"], "sizeGB": None, "gated": None, "verified": False, "community": True})

out_models = []
for m in models:
    if m.get("community") and not m["setups"]:
        continue
    if m.get("community"):
        m["title"] = re.sub(r"-\d{4}$", "", m["title"])
        m["rank"] = 3 if any((x["perf"].get("decodeTokS") or 0) >= 40 for x in m["setups"]) else 2
    variants = []
    for i, v in enumerate(m["variants"]):
        need, sparks = fit(v.get("sizeGB"))
        # The researchers' own figure wins where they gave one (e.g. NVIDIA's tested one-Spark setup that keeps part on disk).
        if v.get("sparks"):
            sparks = v["sparks"]
        elif i == 0 and (m.get("spark") or {}).get("sparks"):
            need, sparks = m["spark"].get("needGB") or need, m["spark"]["sparks"]
        variants.append({"repo": v["repo"], "quant": v.get("quant"), "sizeGB": v.get("sizeGB"), "gated": v.get("gated"),
                         "needGB": need, "sparks": sparks, "community": bool(v.get("community"))})
    best = lambda s: -((s["perf"].get("decodeTokS") or 0))
    out_models.append({
        "id": base(m["title"]), "family": m["family"], "title": m["title"], "released": m.get("released"),
        "categories": m["categories"], "about": m.get("about"), "params": m.get("params"), "contextK": m.get("contextK"),
        "license": m.get("license"), "rank": m.get("rank") or 3, "thinking": m.get("thinking"),
        "engineNotes": (m.get("engineNotes") or "")[:400], "variants": variants, "community": bool(m.get("community")),
        "setups": sorted(m["setups"], key=lambda s: (not s["deployable"], best(s))),
    })
out_models.sort(key=lambda m: (-m["rank"], str(m.get("released") or "")), reverse=False)
out_models.sort(key=lambda m: -m["rank"])

playbooks = [{k: p.get(k) for k in ("id", "title", "description", "category", "sparks", "url")}
             for p in spark["playbooks"] if p.get("status") in (None, "live")]
OUT.write_text(json.dumps({"version": 2, "updated": "2026-11-04", "models": out_models, "playbooks": playbooks}, ensure_ascii=False, indent=1))

setups = [s for m in out_models for s in m["setups"]]
print(f"{len(out_models)} models, {sum(len(m['variants']) for m in out_models)} versions, {len(setups)} setups "
      f"({sum(s['deployable'] for s in setups)} one-click), {len(playbooks)} playbooks; {len(unmatched)} setups matched no model")
print("unmatched models:", sorted({(r.get('modelRepo') or r.get('modelTitle') or '?') for r in unmatched})[:40])
