import { registerPanel } from "./common.js";
import { createSparksPanel } from "./sparks-panel.js";
import { openFleetHomeOnColdEntry } from "./cold-landing.js";

export default {
  id: "sparkie-sparks",
  name: "Sparks",
  description: "Fleet status, power, services and electricity.",
  defaultEnabled: true,
  register(ctx) {
    registerPanel(ctx, { id: this.id, title: "Sparks", path: "/sparks", codicon: "server", create: createSparksPanel });
    openFleetHomeOnColdEntry();
  },
};
