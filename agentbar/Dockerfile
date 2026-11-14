# The agent bar's container: Node 24 (what the repository's tests need), the tools an engine reaches for, and both
# engines at pinned versions. A run's container gets no Docker socket, SSH or keys: an engine inside can't touch
# the Sparks.
# (the Docker command-line tool only, for run-on-spark.sh's runner; the runs' own containers get no Docker socket)
FROM docker:27.5.1-cli AS dockercli

FROM node:24-bookworm
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker

RUN apt-get update \
 && apt-get install -y --no-install-recommends coreutils procps iproute2 jq ripgrep python3 less \
 && rm -rf /var/lib/apt/lists/*

# Pinned (agentbar/engines.mjs says the same). Raise them on purpose, then run the trial again.
RUN npm install -g @opencode/cli@2.2.6 @qwen-code/qwen-code@0.27.0 \
 && npm cache clean --force

ENV NO_UPDATE_NOTIFIER=1 NPM_CONFIG_UPDATE_NOTIFIER=false
