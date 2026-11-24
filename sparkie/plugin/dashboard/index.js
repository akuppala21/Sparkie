  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  function dashboardLink(path) {
    const base = (window.__HERMES_BASE_PATH__ || "").replace(/\/$/, "");
    const url = new URL(base + path, window.location.origin);
    const profile = new URLSearchParams(window.location.search).get("profile");
    if (profile) url.searchParams.set("profile", profile);
    return url.pathname + url.search;
  }

  function HomeLanding() {
    // Hermes titles the root "Sessions". The registered /sparks tab owns
    // Home's title, selected sidebar link and all fleet reads.
    React.useEffect(() => { window.location.replace(dashboardLink("/sparks")); }, []);
    return null;
  }

  if (document.currentScript?.dataset.hermesPlugin === "sparkie-home") {
    window.__HERMES_PLUGINS__.register("sparkie-home", HomeLanding);
  } else {
    const root = "/api/plugins/sparkie-sparks";
    const Sparks = createSparksPanel({
      ...SDK,
      fetchJSON: (path, options) => SDK.fetchJSON(root + path, options?.body ? {
        ...options, headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body),
      } : options),
      profile: () => new URLSearchParams(window.location.search).get("profile"),
      apiLink: path => dashboardLink(root + path),
      pageLink: path => ({ href: dashboardLink(path) }),
    });
    window.__HERMES_PLUGINS__.register("sparkie-sparks", Sparks);
  }
