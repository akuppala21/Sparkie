# The coding trial's runner (agentbar/trial.mjs, started by trial-on-spark.sh): Node.js 26, as the repository's tests
# need, git, and the Docker command-line tool, to start each run's box. The boxes are node:26-bookworm with no network.
FROM docker:27.5.1-cli AS dockercli

FROM node:26-bookworm
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
