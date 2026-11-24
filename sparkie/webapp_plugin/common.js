import React from "react";
import { Button, host, ROUTES_AREA, SIDEBAR_NAV_AREA, useValue } from "@hermes/plugin-sdk";

const h = React.createElement;
function surface(tag, classes) {
  return ({ className = "", ...props }) => h(tag, { ...props, className: classes + " " + className });
}
const components = {
  Button,
  Card: surface("section", "min-w-0 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated)"),
  CardHeader: surface("header", "px-4 pt-4 pb-2"),
  CardTitle: surface("h2", "text-base font-semibold text-(--ui-text-primary)"),
  CardContent: surface("div", "px-4 pb-4"),
};

const destinations = {
  "/chat": "/",
  "/recipes": "/recipes",
  "/models": "/settings?tab=config:model",
};
function pageLink(path) {
  return { href: "#" + destinations[path], onClick(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (path === "/chat") host.newChat();
    else host.navigate(destinations[path]);
  } };
}

export function registerPanel(ctx, { id, path, title, codicon, create }) {
  // ctx.rest supplies the active profile, the session and the plugin's namespace.
  // Selecting another profile/connection remounts the panel to clear old reviews.
  const profile = () => host.state.profile.get() || "default";
  const Page = create({
    React, components, profile, pageLink,
    apiLink(suffix) {
      const base = (window.__HERMES_BASE_PATH__ || "").replace(/\/$/, "");
      const url = new URL(base + "/api/plugins/" + id + suffix, window.location.origin);
      url.searchParams.set("profile", profile());
      return url.pathname + url.search;
    },
    fetchJSON(path, options = {}) {
      return ctx.rest(path, {
        method: options.method,
        body: options.body,
        // The native browser transport owns cancellation and its deadline.
        timeoutMs: options.signal ? 10000 : undefined,
      });
    },
  });

  function RoutedPage() {
    const scope = useValue(host.state.profile);
    const connection = useValue(host.state.connectionId);
    return h("div", { className: "h-full min-h-0 w-full overflow-y-auto bg-(--ui-surface-background) text-(--ui-text-primary)" },
      h("div", { className: "mx-auto w-full p-4", style: { maxWidth: "72rem" } },
        h(Page, { key: JSON.stringify([scope, connection]) })));
  }
  ctx.registerMany([
    { id: "page", area: ROUTES_AREA, title, data: { path }, render: () => h(RoutedPage) },
    { id: "nav", area: SIDEBAR_NAV_AREA, data: { path, label: title, codicon } },
  ]);
}
