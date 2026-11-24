// Staged as the sibling sparkie-recipes plugin so its REST calls are scoped
// by Hermes to the existing recipes backend.
import { registerPanel } from "../sparkie-fleet/common.js";
import { createRecipesPanel } from "../sparkie-fleet/recipes-panel.js";

export default {
  id: "sparkie-recipes",
  name: "Recipes",
  description: "Selected and previously tested serving setups.",
  defaultEnabled: true,
  register(ctx) {
    registerPanel(ctx, { id: this.id, title: "Recipes", path: "/recipes", codicon: "book", create: createRecipesPanel });
  },
};
