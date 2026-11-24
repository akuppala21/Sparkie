# Service dependencies for the ingress parser test

The ingress unit requires Docker. A development worker can run the systemd parser with these three package files even when the worker has no Docker daemon. The test searches the system’s own unit directories first. The parser reads these copies during `systemd-analyze verify`.

| File | Package for Ubuntu 24.04 arm64 | SHA-256 |
| --- | --- | --- |
| docker.service | docker-ce 29.6.2-1 | a12d90fd03761bf79659a185c4a2c40e08934d7ada9e05130e64bd5eb4d634aa |
| docker.socket | docker-ce 29.6.2-1 | 96cd0d89474816ddfb03893b44c36e7d744254aed1bf6d30eca65ff396114656 |
| containerd.service | containerd.io 2.2.5-1 | bd1effcf6d9cd564c232b631b353b2758f174160e3d8c078a792363b59f113d0 |

All three match the files extracted from the NVIDIA Ubuntu 24.04 package repository. The Docker units also match Moby’s source at commit `3d804676`. The packaged containerd unit uses the distribution's executable path. Preserve that version when refreshing the fixtures. [Docker CE package](https://repo.download.nvidia.com/baseos/ubuntu/noble/arm64/pool/common/d/docker-ce/docker-ce_29.6.2-1~ubuntu.24.04~noble_arm64.deb) · [containerd.io package](https://repo.download.nvidia.com/baseos/ubuntu/noble/arm64/pool/common/c/containerd.io/containerd.io_2.2.5-1~ubuntu.24.04~noble_arm64.deb) · [Moby source](https://github.com/moby/moby/tree/3d80467678f6e36325fa9ae3dd486fe91e5652e3/contrib/init/systemd) · [License](LICENSE) · [Notices](NOTICE)
