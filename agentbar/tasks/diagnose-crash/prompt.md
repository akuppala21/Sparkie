The Gemma model I started on Spark 3 crashed right after starting, and I don't know why. Everything I saved is in
the `incident/` folder: its container log, its setup (`incident/spark.json`), and what `nvidia-smi` showed on
Spark 3 at the time.

Find out why it crashed. Then fix its setup in `incident/spark.json` so it will start on Spark 3 as things are now,
changing as little as possible, and keep the context as long as it can be. Write what happened, what you changed and
why in `incident/REPORT.md`.
