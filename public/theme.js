// Applies the saved theme before first paint so there's no flash.
// Dark unless someone picked light, or "match my system", with the theme button.
(() => {
  let theme = 'dark';
  try { theme = localStorage.getItem('spark-console:theme') || 'dark'; } catch {}
  if (theme !== 'system') document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
})();
