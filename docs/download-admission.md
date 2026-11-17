# Ordinary model downloads

Ordinary recipe and download-first starts use compute Sparks. An explicit hub target is refused before the page
creates work. The hub is still scanned for models already there. The brain's own copy and pinned-image start path
stays separate.

`downloadAdmission` checks the configured target and reads free space on the Hugging Face cache's filesystem. If
that folder does not exist, it checks its nearest existing parent without creating anything. Unknown targets,
unreachable Sparks, unknown size and unreadable free space refuse the download. It requires the known size plus
10% and 20 GB free, matching the existing download placement reserve.

The page checks before creating its download operation. `downloadVersion` checks again before starting hf, its
engine-image fallback or a cache write. For GGUF, fresh selected weights and the vision projector must all have
known sizes. Their total can raise the estimate; it never lowers a larger catalog estimate.

This is a preflight estimate. Cache progress is not a measure of transferred bytes. It adds neither a 200 GB task
budget nor continuous disk enforcement, and does not close those contract gaps.


## A stalled transfer

`downloadResume` in `11-downloads.mjs` runs the transfer under a small supervisor on the receiving Spark. Ten minutes
without a change to saved model data stops that attempt. Only a confirmed stop permits another attempt: at most
three resumes, with a fresh disk check before each. Hugging Face partial model files stay in place. The start's
30-minute repair clock begins after its download, so time spent downloading does not consume that window.

A short lease stops the transfer if contact with the console is lost. Cancellation stops the same process group and,
for the image fallback, the exact labelled container. Unknown process or Docker state holds the download; it never
starts a second copy on a guess. Status and locks are private to the request under the cache's
`.spark-console-downloads/<request>` folder. Xet scratch survives its retries and is removed only after every attempt
is known safe; model files are never removed by this cleanup. This is not a durable download queue across restarts.

Saved-file growth measures progress only. It cannot enforce the separate 200 GB network budget or continuous disk
floor. The actual supervisor and fallback command are covered by `download-stall.test.mjs`; the service admission
boundaries are covered by `download-admission.test.mjs`.
