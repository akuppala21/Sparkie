# Evaluation inputs

The public compact comparison uses project-authored technical abstracts with the two original publisher URLs. Read the cited publisher sources for their complete context. Directly comparing this fixture's timing, quoting quality or model accuracy with the retained private run would require identical inputs and model setup.

The historical finalist and held-out comparison harnesses also need two separately provisioned files. Keep any authorized copies outside the public Git index. Place them at these paths beneath a private copy of this directory after source enrollment, then verify the SHA-256 before running. Public URLs alone do not establish redistribution rights or guarantee an identical snapshot.

| Relative path | Required SHA-256 | Source |
| --- | --- | --- |
| `comparison/held-out-sources.json` | `52c3880761d9036430dd15e2041ddeca45c058f03e33c3f0a2fb18e1ed5b0715` | [NVIDIA forum report](https://forums.developer.nvidia.com/t/qwen3-8-27b-nvfp4-on-a-single-dgx-spark-up-to-1m-context-vllm-mtp-measurements/380244) and [Alzeo repository](https://github.com/hasso5703/alzeo) |
| `finalist/MSE.md` | `a1f65ecbbd27c274dd24f2e7465c5250c8038cc853a5e79cb0c53bc46b4ea38c` | [Pinned model card](https://huggingface.co/DevelopingDad/Qwen3.8-27B-Uncensored-NVFP4-MSE-DGX-Spark/blob/8f517aee51d96323dd706c200b9e94c07418d771/README.md) |
