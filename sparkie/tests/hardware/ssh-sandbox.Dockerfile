# Isolated qualification image; not a live application or a host SSH change.
FROM nousresearch/hermes-sandbox@sha256:a561d383d4cf554cd98ca528a450574f86e0b3dcd9496d5b9b0fbd09482c6dd3
USER root
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssh-server=1:10.0p1-7+deb13u4 \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/ssh/ssh_host_* \
 && useradd --uid 12001 --create-home --shell /bin/bash sandbox \
 && passwd -d sandbox \
 && mkdir -p /workspace /run/sshd \
 && chown sandbox:sandbox /workspace /run/sshd
USER sandbox
ENV HOME=/home/sandbox
WORKDIR /workspace
CMD ["sleep", "infinity"]
