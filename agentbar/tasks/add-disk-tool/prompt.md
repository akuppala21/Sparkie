Agents and Sparkie need a quick way to see how much disk is free on each Spark. Add a read-only tool called
`disk_free` that returns, for each Spark that's online, its free disk in GB. Spark Console already measures this, so
use what it has rather than adding a new command on the Sparks.

Make it available to agents through the agent door like the other read tools, and add tests for it. This folder is
Spark Console's code; follow AGENTS.md. When you're done, tell me what you added and how you tested it.
