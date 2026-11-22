import pRetry from 'p-retry';

export function fetchReport(url, {retryBudgetMs}) {
  return pRetry(async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`report service returned ${response.status}`);
    }
    return response.json();
  }, {retries: 2, minTimeout: 10, maxTimeout: retryBudgetMs});
}
