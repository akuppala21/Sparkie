# Disposable qualification fixture only. The release carries its own pinned
# Python; host tools here match the Ubuntu24.04 Spark runtime family.
FROM ubuntu@sha256:ab18ecc70c55c703eae968948f9f1dbbe662aa8d9badac7c982e6a6237b9d74c
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git openssh-client procps systemd libatomic1 tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -u 1000 -o -m -s /bin/bash exampleuser
ENV PYTHONDONTWRITEBYTECODE=1
