(function () {
  "use strict";
  const { React, components, fetchJSON } = window.__HERMES_PLUGIN_SDK__;
  const { Card, CardHeader, CardTitle, CardContent, Button } = components;
  const h = React.createElement;

  function Fields({ entries }) {
    return h("dl", null, ...entries.map(([label, value]) =>
      h("div", { key: label, style: { marginBottom: "0.65rem" } },
        h("dt", { className: "text-sm text-muted-foreground" }, label),
        h("dd", { style: { overflowWrap: "anywhere" } }, value))));
  }

  function recordLink(text, url) {
    return h("a", { href: url, target: "_blank", rel: "noopener noreferrer", className: "underline" }, text);
  }

  function setupDetails(entries) {
    return h("details", { style: { marginBottom: "0.65rem" } },
      h("summary", { style: { cursor: "pointer" } }, "Setup details"),
      h(Fields, { entries }));
  }

  function limits(rows) {
    return h("details", null, h("summary", { style: { cursor: "pointer" } }, "Trial limits"),
      h("ul", { className: "list-disc pl-5" }, ...rows.map(row => h("li", { key: row }, row))));
  }

  function Recipes() {
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState(false);
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
      let active = true;
      setError(false);
      fetchJSON("/api/plugins/sparkie-recipes/catalog").then(result => {
        if (!result?.selected || !result?.comparison) throw new Error("Incomplete catalog");
        if (active) setData(result);
      }).catch(() => { if (active) setError(true); });
      return () => { active = false; };
    }, [retry]);

    const selected = data?.selected;
    const comparison = data?.comparison;
    return h("section", { "aria-label": "Recipes", style: { display: "grid", gap: "1rem" } },
      h("h1", { className: "text-xl font-semibold" }, "Recipes"),
      error ? h("div", { role: "alert" }, "Recipe records could not be loaded. ",
        h(Button, { onClick: () => setRetry(value => value + 1) }, "Retry")) : null,
      !error && !data ? h("p", { role: "status" }, "Loading recipes…") : null,
      selected ? h(Card, null,
        h(CardHeader, null, h(CardTitle, null, "Selected setup")),
        h(CardContent, null,
          h(Fields, { entries: [
            ["Model", recordLink(selected.repository, selected.source)],
            ["Engine", selected.engine + " " + selected.version],
            ["One-Spark trial", selected.serial_decode_tps.toFixed(1) + " tokens/s decoding for one client"],
          ] }),
          h("p", { style: { marginBottom: "0.65rem" } }, selected.qualification),
          setupDetails([
            ["Target revision", selected.revision],
            ["Selected", selected.selected_on],
            ["Engine image", selected.image],
            ["Draft model", recordLink(selected.draft_repository, selected.draft_source)],
            ["Draft revision", selected.draft_revision],
            ["Speculation", selected.algorithm + " · " + selected.draft_tokens + " draft tokens · " + selected.quantization],
            ["Configured context", selected.context.toLocaleString() + " tokens"],
            ["Two-client trial", selected.concurrent_per_request_tps.map(rate => rate.toFixed(1)).join(" and ") + " tokens/s per client"],
            ["Trial time to ready", selected.ready_seconds.toFixed(1) + " seconds"],
            ["Deployment record", selected.deployment_record],
          ]),
          limits(selected.limits))) : null,
      comparison ? h(Card, null,
        h(CardHeader, null, h(CardTitle, null, "Previously tested setup")),
        h(CardContent, null,
          h(Fields, { entries: [
            ["Model", recordLink(comparison.repository, comparison.source)],
          ] }),
          h("p", { style: { marginBottom: "0.65rem" } }, comparison.qualification),
          setupDetails([
            ["Target revision", comparison.revision],
            ["Engine image", comparison.image],
            ["Engine digest", comparison.digest],
          ]),
          limits(comparison.limits))) : null);
  }
  window.__HERMES_PLUGINS__.register("sparkie-recipes", Recipes);
})();
