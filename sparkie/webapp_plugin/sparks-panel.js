export function createSparksPanel(SDK) {
  const { React } = SDK;
  const { Card, CardHeader, CardTitle, CardContent, Button } = SDK.components;
  const h = React.createElement;
  const labels = { online: "Running", off: "Off", starting: "Starting", stopping: "Stopping", unreachable: "Not reachable", unknown: "Unknown" };
  const gib = value => typeof value === "number" ? (value / 1073741824).toFixed(1) + " GiB" : "Not measured";
  const allows = (controls, spark, action) => controls.data?.by_spark?.[spark]?.actions?.includes(action) === true;
  const needsStatus = result => result?.available === true && result.operations.some(row => ["dispatching", "uncertain"].includes(row.state));
  const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");

  async function readControls(signal, selectedUpdate) {
    const result = await SDK.fetchJSON("/controls", { signal });
    if (!result || typeof result.available !== "boolean" || (result.available && !Array.isArray(result.operations))) throw new Error("Invalid controls result");
    if (result.available && selectedUpdate) {
      const row = await SDK.fetchJSON("/operations/" + selectedUpdate, { signal });
      if (row.id !== selectedUpdate || row.intent?.action !== "update_application" || row.review_available) throw new Error("Update review unavailable");
      return { ...result, operations: [row, ...result.operations.filter(item => item.id !== row.id)] };
    }
    return result;
  }

  function useControls(refreshVersion, changesRef) {
    const [data, setData] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [refreshStopped, setRefreshStopped] = React.useState(false);
    const pending = React.useRef(null);
    const selectedUpdate = React.useRef(null);
    const reload = React.useCallback(async () => {
      setData(await readControls(undefined, selectedUpdate.current));
    }, []);
    React.useEffect(() => {
      let active = true;
      readControls(undefined, selectedUpdate.current).then(result => {
        if (active) { setData(result); setError(""); setRefreshStopped(false); }
      }).catch(() => { if (active) { setData(null); setRefreshStopped(true); setError("Spark controls could not be loaded. Refresh to try again."); } });
      return () => { active = false; };
    }, [refreshVersion]);
    const awaitingResult = needsStatus(data);
    React.useEffect(() => {
      if (!awaitingResult || busy || refreshStopped) return;
      let active = true;
      let timer = null;
      let reading = false;
      let controller = null;
      const deadline = Date.now() + 480000;
      const schedule = () => {
        clearTimeout(timer);
        if (!active || reading || document.visibilityState !== "visible") return;
        if (Date.now() >= deadline) {
          setRefreshStopped(true);
          setError("Still waiting for a verified result. Refresh to keep checking.");
          return;
        }
        timer = setTimeout(refreshStatus, 3000);
      };
      const refreshStatus = async () => {
        if (!active || document.visibilityState !== "visible") return;
        if (Date.now() >= deadline) {
          setRefreshStopped(true);
          setError("Still waiting for a verified result. Refresh to keep checking.");
          return;
        }
        reading = true;
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 10000);
        try {
          const result = await readControls(controller.signal, selectedUpdate.current);
          if (!active) return;
          setData(result);
          reading = false;
          if (needsStatus(result)) schedule();
        } catch (_) {
          if (active) { setRefreshStopped(true); setError("The request status could not be loaded. Refresh to check it."); }
        } finally { clearTimeout(timeout); controller = null; reading = false; }
      };
      document.addEventListener("visibilitychange", schedule);
      schedule();
      return () => {
        active = false;
        clearTimeout(timer);
        controller?.abort();
        document.removeEventListener("visibilitychange", schedule);
      };
    }, [awaitingResult, busy, refreshStopped, refreshVersion]);
    const send = async (path, body) => {
      if (pending.current?.sending) return;
      if (pending.current) pending.current.sending = true;
      setBusy(true);
      setError("");
      setRefreshStopped(false);
      try {
        const row = await SDK.fetchJSON("/" + path, {
          method: "POST", body: body || {},
        });
        if (path === "updates") selectedUpdate.current = row.id;
        pending.current = null;
      } catch (_) {
        setError("The reply could not be loaded. Refresh and check the request before trying again.");
      } finally {
        if (pending.current) pending.current.sending = false;
        try { await reload(); } catch (_) { setRefreshStopped(true); setError("The result could not be checked. Refresh before trying again."); }
        setBusy(false);
      }
    };
    const prepareTarget = (intent, path = "operations") => {
      if (busy || pending.current?.sending) return;
      const key = JSON.stringify(intent);
      // A lost preparation reply reuses its request identity. Confirmation itself
      // is never retried automatically; the shared ledger supplies its result.
      if (!pending.current || pending.current.key !== key) pending.current = {
        key, id: requestId(),
      };
      return send(path, { request_id: pending.current.id, ...intent })
        .finally(() => changesRef.current?.focus());
    };
    const prepare = (action, spark, container) => prepareTarget({ action, spark, ...(container ? { container } : {}) });
    const act = (row, verb) => {
      if (busy || pending.current?.sending) return;
      pending.current = { sending: false };
      const signed = ["confirm", "accept_update", "rollback_update"].includes(verb);
      return send("operations/" + row.id + "/" + verb, signed ? { digest: row.digest } : {});
    };
    const prepareMemory = (target, literal) => {
      if (busy || pending.current?.sending) return;
      pending.current = { sending: false };
      return send("memory/erase", { request_id: requestId(), target, literal })
        .finally(() => changesRef.current?.focus());
    };
    const reviewUpdate = async id => {
      if (busy || pending.current?.sending) return;
      selectedUpdate.current = id;
      setBusy(true);
      setError("");
      try { await reload(); }
      catch (_) {
        selectedUpdate.current = null;
        setError("The complete update review could not be loaded. Open the request again.");
      } finally { setBusy(false); }
    };
    return { data, busy, error, prepare, prepareTarget, prepareMemory, reviewUpdate, act };
  }

  function Services({ controls, refreshVersion }) {
    const [rows, setRows] = React.useState(null);
    const [error, setError] = React.useState("");
    const [choices, setChoices] = React.useState({});
    const [logs, setLogs] = React.useState({});
    const [loadingLog, setLoadingLog] = React.useState(null);
    const operationStates = (controls.data?.operations || []).filter(row => ["start_service", "stop_service"].includes(row.intent.action))
      .map(row => row.id + ":" + row.state).join(",");
    React.useEffect(() => {
      let active = true;
      SDK.fetchJSON("/services").then(result => {
        if (!Array.isArray(result)) throw new Error("Unavailable service catalog");
        if (active) { setRows(result); setError(""); }
      }).catch(() => { if (active) { setRows(null); setError("Model and app controls could not be loaded. Refresh to check them."); } });
      return () => { active = false; };
    }, [refreshVersion, operationStates]);
    const readLogs = async (recipe, instance) => {
      if (loadingLog) return;
      setLoadingLog(instance);
      try {
        const result = await SDK.fetchJSON("/services/" + recipe + "/logs?instance=" + instance);
        if (!Array.isArray(result)) throw new Error("Unavailable runtime log");
        setLogs(saved => ({ ...saved, [instance]: result.join("\n") || "No runtime log entries are available." }));
      } catch (_) { setLogs(saved => ({ ...saved, [instance]: "The runtime log could not be checked. Refresh to try again." })); }
      finally { setLoadingLog(null); }
    };
    return h("section", { "aria-label": "Models and apps", id: "services", style: { marginBottom: "1rem" } },
      h("h2", { className: "text-lg font-semibold", style: { marginBottom: "0.75rem" } }, "Models and apps"),
      error ? h("p", { role: "status" }, error) : null,
      !error && rows === null ? h("p", { role: "status" }, "Loading available setups…") : null,
      rows?.length === 0 ? h("p", null, "No reviewed model or app setups are available yet.") : null,
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))", gap: "1rem" } },
        ...(rows || []).map(row => {
          const active = row.instances.filter(item => item.held);
          const selected = choices[row.recipe] || row.sparks[0];
          const title = row.recipe === "artifact-browser" ? "Artifacts" : row.recipe === "glm-flash" ? "GLM Flash · local model" : row.recipe;
          return h(Card, { key: row.recipe },
            h(CardHeader, null, h(CardTitle, null, title)),
            h(CardContent, null,
              h("p", { className: "text-sm" }, row.kind === "app" ? "Browse the enrolled artifacts folder. Files stay read-only." : "Run this additional model on a compute Spark."),
              h("p", { className: "text-sm text-muted-foreground", style: { marginTop: "0.5rem" } },
                row.resources.cpu + " CPUs · " + (row.resources.memory_mb / 1024).toFixed(1) + " GiB memory" + (row.resources.gpu ? " · GPU" : "")),
              active.length ? null : h("div", { style: { display: "flex", alignItems: "end", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" } },
                h("label", null, "Run on ", h("select", { "aria-label": "Spark for " + title, value: selected,
                  onChange: event => setChoices(saved => ({ ...saved, [row.recipe]: event.target.value })) },
                  ...row.sparks.map(spark => h("option", { key: spark, value: spark }, "Spark " + spark.slice(-1))))),
                h(Button, { disabled: controls.busy || !selected || !allows(controls, selected, "start_service"),
                  onClick: () => controls.prepareTarget({ action: "start_service", spark: selected, recipe: row.recipe, revision: row.revision }) }, "Review start")),
              ...active.map(item => h("div", { key: item.instance, style: { marginTop: "0.75rem" } },
                h("p", null, "Spark " + item.spark.slice(-1) + " · " + ({ ready: "Ready", starting: "Starting", reserved: "Preparing", stopping: "Stopping" }[item.phase] || "Result needs checking")),
                h("p", { className: "text-xs text-muted-foreground", style: { overflowWrap: "anywhere" } }, "Instance: " + item.instance),
                h("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" } },
                  item.phase === "ready" && row.url ? h("a", { className: "underline", target: "_blank", rel: "noopener noreferrer",
                    href: SDK.apiLink("/services/" + row.recipe + "/open?instance=" + item.instance) }, row.kind === "model" ? "View endpoint" : "Open app") : null,
                  h(Button, { disabled: Boolean(loadingLog), onClick: () => readLogs(row.recipe, item.instance) }, loadingLog === item.instance ? "Reading…" : "Runtime log"),
                  item.phase === "ready" ? h(Button, { disabled: controls.busy,
                    onClick: () => controls.prepareTarget({ action: "stop_service", spark: item.spark, recipe: row.recipe, revision: row.revision, instance: item.instance }) }, "Review stop") : null),
                logs[item.instance] ? h("pre", { role: "status", className: "text-sm", style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "15rem", overflow: "auto", marginTop: "0.5rem" } }, logs[item.instance]) : null)),
              row.kind === "model" && row.url ? h("p", { className: "text-sm", style: { marginTop: "0.75rem", overflowWrap: "anywhere" } }, "Stable API: ", h("code", null, row.url + "v1"), ". Requires your native Hermes owner sign-in.") : null));
        })));
  }

  function MemoryChanges() {
    const [rows, setRows] = React.useState(null);
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [visible, setVisible] = React.useState(false);
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => {
      if (!visible) return;
      let current = true;
      setRows(null);
      SDK.fetchJSON("/memory/changes").then(data => {
        if (current) { setRows(data); setError(""); }
      }).catch(() => { if (current) setError("Memory changes could not be loaded."); });
      return () => { current = false; };
    }, [visible, revision]);
    async function decide(row, action) {
      setBusy(true);
      try {
        await SDK.fetchJSON("/memory/changes/" + row.id + "/" + action, {
          method: "POST", body: {digest: row.digest},
        });
        setError("");
        setRevision(n => n + 1);
      } catch (_) { setError("The decision could not be verified. Refresh to check the request."); }
      finally { setBusy(false); }
    }
    return h("details", {onToggle: event => setVisible(event.currentTarget.open)},
      h("summary", null, "Memory changes"),
      h(Button, {type: "button", disabled: busy, onClick: () => setRevision(n => n + 1)}, "Refresh requests"),
      error && h("p", {role: "alert"}, error),
      rows?.length === 0 && h("p", null, "No memory changes are waiting."),
      rows?.map(row => h("section", {key: row.id},
        h("h4", null, (row.action === "patch" ? "Correct " : "Add to ") + (row.target === "user" ? "user preferences" : "assistant memory")),
        row.entry && h("div", null, "Existing entry", h("pre", {style: {whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}, row.entry)),
        row.find && h("div", null, "Find", h("pre", {style: {whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}, row.find)),
        h("p", null, "Proposed text"), h("pre", {style: {whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}, row.content),
        row.state === "held" && h("p", null, "Held request " + row.id + ". Proposed entry currently " +
          (row.observation.proposed_entry_present ? "present." : "absent.") +
          (row.observation.prior_entry_present ? " The original entry is still present." : "") +
          " Refresh to check this request again."),
        row.state === "held" && h(Button, {type: "button", disabled: busy, onClick: () => decide(row, "close")}, "Close without retry"),
        row.state === "pending" && h(Button, {type: "button", disabled: busy, onClick: () => decide(row, "approve")}, "Confirm this change"),
        row.state === "pending" && h(Button, {type: "button", disabled: busy, onClick: () => decide(row, "reject")}, "Reject"))));
  }

  function EraseMemory({ controls }) {
    const profile = SDK.profile();
    if (!controls.data?.memory_erasure || (profile && profile !== "default")) return null;
    const submit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      form.reset();
      controls.prepareMemory(values.get("target"), values.get("literal"));
    };
    return h("details", { style: { marginBottom: "1rem" } },
      h("summary", null, "Erase memory"),
      h("p", { className: "text-sm" }, "Choose an entry in the default profile and enter the exact text to erase. You’ll review its scope before confirming."),
      h("form", { onSubmit: submit, style: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: "0.5rem" } },
        h("label", null, "Store ",
          h("select", { name: "target" }, h("option", { value: "memory" }, "Assistant memory"),
            h("option", { value: "user" }, "User preferences"))),
        h("label", null, "Exact text ",
          h("input", { name: "literal", required: true, maxLength: 512, autoComplete: "off", spellCheck: false,
            style: { maxWidth: "100%", border: "1px solid currentColor", padding: "0.25rem" } })),
        h(Button, { type: "submit", disabled: controls.busy }, "Review erase")));
  }

  function Changes({ controls, regionRef }) {
    const profile = SDK.profile();
    const rows = controls.data?.operations || [];
    return h("div", { ref: regionRef, tabIndex: -1, role: "region", "aria-label": "Spark change requests",
      "aria-busy": controls.busy, style: { marginBottom: "1rem" } },
      controls.error ? h("p", { role: "alert" }, controls.error) : null,
      controls.data && !controls.data.available ? h("p", { role: "status" }, controls.data.message) : null,
      controls.data?.available && (!profile || profile === "default") && h(MemoryChanges, {}),
      h(EraseMemory, { controls }),
      controls.data?.application_updates ? h("details", { style: { marginBottom: "1rem" } },
        h("summary", null, "Update Sparkie"),
        h("form", { onSubmit: event => {
          event.preventDefault();
          const proposal = new FormData(event.currentTarget).get("proposal");
          controls.prepareTarget({ proposal }, "updates");
        }, style: { display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "end" } },
          h("label", null, "Proposal SHA-256 ",
            h("input", { name: "proposal", pattern: "[a-f0-9]{64}", required: true, maxLength: 64,
              autoComplete: "off", spellCheck: false, style: { maxWidth: "100%" } })),
          h(Button, { type: "submit", disabled: controls.busy }, "Review update"))) : null,
      rows.length ? h(Card, null, h(CardHeader, null, h(CardTitle, null, rows.some(row => row.intent.action === "erase_memory") ? "Change requests" : "Spark changes")),
        h(CardContent, null, ...rows.filter((row, index) => index < 5 || (row.review_available &&
          ["pending", "dispatching", "uncertain"].includes(row.state))).map(row => h("div", { key: row.id, style: { marginBottom: "1rem", overflowWrap: "anywhere" } },
          h("p", { className: "font-medium", style: { whiteSpace: "pre-wrap" } }, row.description),
          h("p", { role: "status", className: "text-sm" }, row.message),
          row.recovery?.message ? h("p", { className: "text-sm", "data-recovery-policy": row.recovery.retry_policy },
            "Recovery: " + row.recovery.message) : null,
          h("p", { className: "text-sm text-muted-foreground" }, "Request: " + row.id),
          row.review_available ? h(Button, { disabled: controls.busy, onClick: () => controls.reviewUpdate(row.id) }, "Review update details") :
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" } },
            ...[["confirm", { erase_memory: "Erase memory", update_application: "Install this version" }[row.intent.action] || "Run it"],
              ["cancel", "Cancel"], ["check", "Check result"], ["accept_update", "Keep this version"],
              ["rollback_update", "Restore previous version"]]
              .filter(([verb]) => row["can_" + verb])
              .map(([verb, label]) => h(Button, { key: verb, disabled: controls.busy, onClick: () => controls.act(row, verb) }, label))))))) : null);
  }

  function Electricity({ refreshVersion }) {
    const [period, setPeriod] = React.useState("month");
    const [selected, setSelected] = React.useState("");
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState("");
    const [rate, setRate] = React.useState("");
    const [customRate, setCustomRate] = React.useState("");
    const selectStyle = { background: "var(--background)", color: "inherit", border: "1px solid currentColor", padding: "0.4rem", borderRadius: "0.3rem", maxWidth: "100%", minWidth: 0 };
    React.useEffect(() => {
      let active = true;
      setData(null);
      setError("");
      const query = new URLSearchParams({ period, ...(selected ? { selected } : {}) });
      SDK.fetchJSON("/energy?" + query.toString())
        .then(result => {
          if (!result || !Array.isArray(result.months) || !Array.isArray(result.sparks)) throw new Error("Invalid energy result");
          if (active) setData(result);
        }).catch(() => { if (active) setError("Electricity readings could not be loaded. Try refreshing the page."); });
      return () => { active = false; };
    }, [period, selected, refreshVersion]);
    const periods = data?.periods || data?.months || [];
    const activeSelection = data?.selected || data?.month || "";
    const chosenRate = rate === "custom" ? customRate : rate;
    const amount = /^(?:\d+|\d*\.\d{1,6})$/.test(chosenRate) && Number(chosenRate) <= 10 ? Number(chosenRate) : null;
    const money = value => "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    return h(Card, { style: { marginBottom: "1rem" }, role: "region", "aria-label": "Electricity" },
      h(CardHeader, null,
        h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" } },
          h(CardTitle, null, "Electricity"),
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.5rem", minWidth: 0 } },
            h("select", { "aria-label": "Electricity period", value: period, style: selectStyle,
              onChange: event => { setPeriod(event.target.value); setSelected(""); } },
              ...["day", "week", "month", "year"].map(value => h("option", { key: value, value }, value[0].toUpperCase() + value.slice(1)))),
            data ? h("select", { "aria-label": "Electricity " + period, value: activeSelection,
              onChange: event => setSelected(event.target.value), style: selectStyle },
              ...periods.map(value => h("option", { key: value, value }, value))) : null))),
      h(CardContent, null,
        error ? h("p", { role: "alert" }, error) : !data ? h("p", { role: "status" }, "Loading electricity…") :
          h(React.Fragment, null,
            h("p", { className: "text-xl font-semibold" }, data.recorded_kwh === null ? "No measured total yet" : data.recorded_kwh.toFixed(3) + " kWh recorded"),
            h("p", { className: "text-lg font-semibold", role: "status" }, amount !== null && typeof data.recorded_kwh === "number"
              ? money(data.recorded_kwh * amount) + " estimated cost"
              : amount !== null ? "No recorded usage to price yet" : "Choose a rate to estimate cost"),
            h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" } },
              h("label", { htmlFor: "sparkie-electricity-rate" }, "Rate"),
              h("select", { id: "sparkie-electricity-rate", "aria-label": "Electricity rate", value: rate, style: selectStyle,
                onChange: event => setRate(event.target.value) },
                h("option", { value: "" }, "Choose a rate"),
                ...(data.rate_presets || []).map(value => h("option", { key: value, value: String(value) }, "$" + value.toFixed(2) + " / kWh")),
                h("option", { value: "custom" }, "Custom…")),
              rate === "custom" ? h("input", { "aria-label": "Custom electricity rate", type: "number", min: "0", max: "10", step: "0.000001", value: customRate,
                placeholder: "USD per kWh", style: { ...selectStyle, width: "9rem" }, onChange: event => setCustomRate(event.target.value) }) : null),
            chosenRate && amount === null ? h("p", { role: "alert", className: "text-sm" }, "Choose a rate from $0 to $10 per kWh, with at most six decimal places.") : null,
            h("p", { className: "text-sm", style: { marginTop: "0.5rem" } }, "Preset amounts are estimates, not a utility tariff. Changing the rate recalculates the selected period immediately."),
            h("p", { className: "text-sm", style: { marginTop: "0.5rem" } }, data.message),
            h("p", { className: "text-sm" }, "Cost estimates cover recorded usage only. Missing usage, fixed charges and taxes are excluded."),
            h("p", { className: "text-sm" }, "Calendar periods in Pacific time."),
            h("ul", { style: { marginTop: "0.5rem" } }, ...data.sparks.map(spark => h("li", { key: spark.id },
              spark.name + ": " + (spark.recorded_kwh === null ? "No measured total" : spark.recorded_kwh.toFixed(3) + " kWh" +
                (amount !== null ? " · " + money(spark.recorded_kwh * amount) + " estimated cost" : ""))))))));
  }

  function Details({ spark, controls }) {
    const m = spark.metrics || {};
    const items = Array.isArray(spark.workloads) ? spark.workloads : null;
    const links = Array.isArray(spark.network_links) ? spark.network_links : null;
    const group = (kind, label) => {
      const rows = items?.filter(item => item.kind === kind) || [];
      if (!rows.length) return null;
      return h("div", { style: { marginTop: "0.75rem" } },
        h("h3", { className: "font-medium" }, label),
        h("ul", null, ...rows.map(item => h("li", { key: item.id },
          h("details", null, h("summary", { style: { cursor: "pointer", overflowWrap: "anywhere" } }, item.name),
            h("p", { className: "text-sm", style: { overflowWrap: "anywhere" } }, "Image: ", item.image),
            h("p", { className: "text-sm" }, "Observed running at the update time above."),
            kind === "workload" && !spark.host && /^[a-f0-9]{64}$/.test(item.id) && allows(controls, spark.id, "stop_workload")
              ? h(Button, { disabled: controls.busy || spark.stale, onClick: () => controls.prepare("stop_workload", spark.id, item.id) }, "Stop workload") : null)))));
    };
    return h("div", null,
      spark.issue ? h("p", { role: "alert" }, spark.issue) : null,
      h("dl", { style: { marginTop: "0.75rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem" } },
        h("dt", null, "Memory free"), h("dd", null, gib(m.memory_available_bytes)),
        h("dt", null, "Storage free"), h("dd", null, gib(m.disk_free_bytes)),
        h("dt", null, "GPU use"), h("dd", null, typeof m.gpu_utilization_percent === "number" ? m.gpu_utilization_percent + "%" : "Not measured"),
        h("dt", null, "Wall power"), h("dd", null, typeof spark.wall?.watts === "number" ? spark.wall.watts.toFixed(1) + " W" : "Not measured")),
      items === null ? h("p", { className: "text-sm", style: { marginTop: "0.75rem" } }, spark.observed_state === "off" ? "Workload details will refresh when this Spark is running." : "Running workloads could not be checked.") :
        items.length === 0 ? h("p", { className: "text-sm", style: { marginTop: "0.75rem" } }, "No running containers were observed.") : null,
      group("workload", "Workloads"), group("infrastructure", "Supporting services"),
      h("details", { style: { marginTop: "0.75rem" } },
        h("summary", { style: { cursor: "pointer" } }, "Network links"),
        links === null ? h("p", { className: "text-sm" }, "Network links have not been measured.") :
          links.length === 0 ? h("p", { className: "text-sm" }, "No physical network ports were reported.") :
            h("ul", { className: "text-sm" }, ...links.map(link => h("li", { key: link.name, style: { overflowWrap: "anywhere" } },
              link.name + " · " + (link.kind === "wifi" ? "Wi-Fi" : "Ethernet") + " · " +
              (link.state === "up" ? "Link up" : link.state === "down" ? "No link" : "Link unknown") +
              (typeof link.speed_mbps === "number" ? " · " + (link.speed_mbps >= 1000 ? link.speed_mbps / 1000 + " Gbps" : link.speed_mbps + " Mbps") : "")))),
        h("p", { className: "text-sm text-muted-foreground" }, "These are observed port readings. Cable peers have not been verified.")));
  }

  function Sparks() {
    const [data, setData] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [refreshVersion, setRefreshVersion] = React.useState(0);
    const changesRef = React.useRef(null);
    const controls = useControls(refreshVersion, changesRef);
    const request = React.useRef(0);
    const refresh = React.useCallback(async () => {
      const id = ++request.current;
      setRefreshVersion(version => version + 1);
      setBusy(true);
      setError("");
      try {
        const result = await SDK.fetchJSON("/fleet");
        if (!result || typeof result.available !== "boolean" || !Array.isArray(result.sparks)) throw new Error("Invalid fleet result");
        if (request.current === id) setData(result);
      } catch (_) {
        if (request.current === id) {
          setData(null);
          setError("Fleet observations could not be loaded. Try again.");
        }
      } finally {
        if (request.current === id) setBusy(false);
      }
    }, []);
    React.useEffect(() => { refresh(); return () => { request.current++; }; }, [refresh]);
    return h("section", { "aria-label": "Sparks" },
      h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "1rem" } },
        h("h1", { className: "text-xl font-semibold" }, "Sparks"),
        h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "1rem" } },
          h("a", { ...SDK.pageLink("/chat"), className: "font-medium underline" }, "Ask Sparkie"),
          h("a", { ...SDK.pageLink("/models"), className: "font-medium underline" }, "Models"),
          h("a", { ...SDK.pageLink("/recipes"), className: "font-medium underline" }, "Recipes"),
          h(Button, { onClick: refresh, disabled: busy }, busy ? "Loading…" : "Refresh"))),
      error ? h("p", { role: "alert" }, error) : null,
      data ? h("p", { role: "status", style: { marginBottom: "1rem" } }, data.message) : null,
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 15rem), 1fr))", gap: "1rem", marginBottom: "1rem" } },
        ...(data?.sparks || []).map(spark => h(Card, { key: spark.id },
          h(CardHeader, null, h(CardTitle, null, spark.name)),
          h(CardContent, null,
            h("p", null, spark.host ? "Always-on host" : "Compute Spark"),
            h("p", null, "Last observed: ", labels[spark.observed_state] || "Unknown"),
            h("p", { className: "text-sm text-muted-foreground" }, new Date(spark.observed_at).toLocaleString()),
            spark.stale ? h("p", { className: "text-sm" }, "Older observation. Current state has not been checked.") : null,
            !spark.host && controls.data?.available ? h("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" } },
              allows(controls, spark.id, "wake") ? h(Button, { disabled: controls.busy, onClick: () => controls.prepare("wake", spark.id) }, "Wake " + spark.name) : null,
              allows(controls, spark.id, "sleep") ? h(Button, { disabled: controls.busy, onClick: () => controls.prepare("sleep", spark.id) }, "Shut down " + spark.name) : null,
              controls.data.by_spark?.[spark.id]?.message ? h("p", { className: "text-sm", role: "status" }, controls.data.by_spark[spark.id].message) : null) : null,
            h(Details, { spark, controls }))))),
      h(Services, { controls, refreshVersion }),
      h(Changes, { controls, regionRef: changesRef }),
      h(Electricity, { refreshVersion }));
  }
  return Sparks;
}
