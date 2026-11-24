  const SDK = window.__HERMES_PLUGIN_SDK__;
  const Recipes = createRecipesPanel({
    ...SDK, fetchJSON: path => SDK.fetchJSON("/api/plugins/sparkie-recipes" + path),
  });
  window.__HERMES_PLUGINS__.register("sparkie-recipes", Recipes);
