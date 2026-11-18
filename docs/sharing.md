# Using Spark Console on all your devices, from anywhere

**Status:** built 2026-11-04; passkeys on the page since 2026-11-05; Funnel with passkey sign-in since 2026-11-09.
One address only since 2026-11-11 (the owner's choice; contract section 13). Members and sharing taken out 2026-11-14
(contract 2.1): the owner is the only user. All free.

## Who sees what

| Who | Where they come from | What they get |
|---|---|---|
| Anyone | The internet, when the main address is open to it (below) | The fleet page: each Spark's name, online or not, GPU use, memory, temperature, power, and which Sparks are cabled together, and **Sign in**. Nothing about models, chats, jobs, files, people or addresses. |
| Someone on your tailnet who isn't you | The main address | The same fleet page. Every other route answers them 401, as it answers nobody. |
| You | Tailscale, signed in as the owner, on any device; or, without Tailscale, a device you signed in (below) | Everything. |

Identity comes from Tailscale: Tailscale Serve tells Spark Console who's asking. There are no passwords.

## Without Tailscale (2026-11-09, contract 4.10)

`bash spark-console/deploy/open-to-internet.sh` opens the main address (`https://akspark1.<tailnet>.ts.net:8443/`) to
the internet with Tailscale Funnel; `--undo` closes it again. Only port 8443's Funnel switch changes. From the
internet, nobody gets past the fleet page until they sign in:
- **A browser:** Sign in → **Use passkey** (Face ID, Touch ID). It stays signed in until 60 days after its last use.
- **A device without your passkey** (a new phone, a terminal): it shows a code; on a signed-in device, open your
  account menu → **Let a device in**, enter the code (or scan its QR code) and confirm with your passkey. In a
  terminal: `node spark-console/tools/console.mjs sign-in`.
- **Agents:** their own key, from anywhere.

Your account menu → **Your devices** lists every signed-in device, each with **Sign out**. NVIDIA's network blocks `ts.net` addresses, and Spark Console doesn't route around that.

### Your apps from anywhere: the app door (2026-11-12)

The apps Spark Console keeps running for you (`keep_running`: Open WebUI, Jupyter, code-server, ComfyUI…, on any Spark
but Sparkie's) listen only on their Spark's tailnet address, so off the tailnet their links don't open. The app door
opens them from anywhere, your phone without Tailscale too, once you're signed in to Spark Console; there's no other
password. To turn it on, once, from your Mac:

```bash
bash spark-console/deploy/open-apps-to-internet.sh          # opens port 10000 of the main name, Funnel on it
bash spark-console/deploy/open-apps-to-internet.sh --undo   # closes it again
```

It changes only port 10000 (never 443 or 8443), stops if something else is there, and running it twice is harmless.
Within a minute, wherever Spark Console gives an app's link, the first is the door's
(`https://akspark1.<tailnet>.ts.net:10000/console/api/open/<spark>/<app>`) and the second, "on your tailnet", the
direct one. Open the door's link on a device signed in to Spark Console. **One browser runs one app at a time**:
opening another while the first is in use asks first, and "Switch anyway" closes the first app's connections; a tab of it
left open would then send its saves to the new app, so close that tab first. Only you get through it, and after Spark Console restarts or updates, open the app again from its link.

## One portal, one address, with Sign in

**One address:** `https://akspark1.<tailnet>.ts.net:8443/` (`origin` in `service/config.json`). On your tailnet it
opens for you; from the internet, when it's open (above), it shows the fleet and **Sign in**. What you see depends only
on who you are:

- **You:** everything.
- **Anyone else on your tailnet:** the fleet page.

**Your passkey.** For the few changes to who may act — creating agent keys, letting an agent change things, resuming
agents you paused, letting a device in, deploying a model that runs its own code, and passkeys themselves — you also
confirm with a passkey (Touch ID, Face ID, a phone or a security key). Taking a right away (removing an agent, pausing
agents) never needs it, and neither does resuming agents after they paused themselves.

- A small dialog shows the change in plain words ("Create a key for a new agent, “Claude on my Mac”"), then asks
  for your passkey. Each confirmation is a one-time challenge tied to that exact change, so a program on your Mac can't
  make these changes with Tailscale's identity alone.
- Passkeys are made for your tailnet's domain (or for the address itself) and work on Spark Console's page, never
  inside another site's page.
- Set passkeys up under your name (top right) → Your passkey. Until you set one up, these changes need none. Set up two
  (say, your Mac's Touch ID and your phone), so losing one device never matters.
- What it covers, honestly: the passkey stops other programs and agents from using your Tailscale identity to change
  who may act. It doesn't stop something that already has a shell on Spark 2 as you, and anything with your
  Tailscale identity can still look, stop models and save files.
- A passkey whose counter goes backwards (which can mean it was copied) still works; it's noted in Activity, so your
  only passkey can never lock you out.

**If you're locked out of a passkey change** (lost every passkey, the Tailscale DNS name changed, or `passkeys.json`
can't be read), start over from your Mac. SSH needs no passkey:

```bash
ssh akuppala@100.79.155.126 'mv ~/.local/state/spark-console/passkeys.json ~/.local/state/spark-console/passkeys.json.old'
```

That takes effect at once: these changes work without a passkey again, and you set a new one up. Each install keeps a
copy of the state folder under `~/.local/share/spark-console/releases/<time>/state/`, and Spark 3 (or 4) keeps copies
taken while it was on under `~/.local/share/spark-console/backups/` (one a day, the last 14). To put one back: stop the
service, then run `tar -xzf <copy> -C ~/.local/state/spark-console --exclude=./sessions.json
--exclude=./saved-runs.json --exclude=./saved-runs.json.prev --exclude=./self-test.json --exclude=./self-test.json.prev` (one line). Before starting the service again, run
`rm -f ~/.local/state/spark-console/saved-runs.json{,.prev} ~/.local/state/spark-console/self-test.json{,.prev}`. Older copies can hold sign-ins and old authority to stop
current workloads; an old authority file already in the destination must go too. Every device signs in again. A new Spark 2 after a lost disk: `deploy/REBUILD.txt`, step by step.

For an older install snapshot, stop the service first. Before using its `restore.sh --with-state`, remove
`saved-runs.json{,.prev}` and `self-test.json{,.prev}` from both its `state/` folder and the live state folder.
Those are old permission to stop work. A program-only rollback uses no `--with-state` and keeps the current notes.

**If the API lock gets in the way**, `bash spark-console/deploy/lock-api.sh --undo` points Tailscale back at the local
port, removes the lock and restarts the service.

## No members, no sharing (2026-11-14)

Spark Console has one user, you (contract 2.1). Members, asking to be let in, the share link and the page's people
views are gone; someone on your tailnet who isn't you gets the fleet page and nothing else. An older build kept
members, requests and a share link in `~/.local/state/spark-console/access.json`: they stay there, unread, so going
back a build finds its files as it left them. Nothing needs them; delete them by hand if you like (stop the service
first).

## Your own devices

- **Phone:** install Tailscale and sign in with your account. Then scan the code under your name (top right) → Your
  devices, and add the page to your Home Screen (iPhone: Share → Add to Home Screen; Android: ⋮ → Install app).
- **Laptop:** Tailscale signed in as you; in Chrome or Edge, Install app from the address bar.

Every device signed in to Tailscale as you is the owner.

## The retired short address and web page (2026-11-11)

Until 2026-11-11 Spark Console also had a short address (its own Tailscale device, `sparks`, in a container on Spark 2)
and a copy of the fleet page on Cloudflare. The owner retired both for one address. On this fleet they are already
removed (container, network, state files, the `sparks` device and the `sparks-fleet` page). On any other Spark 2 that
still has them, the owner removes them by hand; the console never does:

    docker rm -f spark-console-door; docker network rm spark-console-door
    rm -f ~/.local/state/spark-console/door.json ~/.local/state/spark-console/cloud.json
    rm -rf ~/.local/state/spark-console/door ~/.local/share/spark-console-www ~/.config/spark-console-door
    sudo rm -rf ~/.local/state/spark-console-door     # its Tailscale state is owned by root

Then delete the device in the Tailscale admin console and the page with `npx wrangler delete <name>`. The installer prints
these lines when it finds `door.json` or the container.
