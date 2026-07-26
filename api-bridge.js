(function () {
  async function robustCallApi(action, payload = {}) {
    const url = window.APP_CONFIG && window.APP_CONFIG.API_URL;
    if (!url) throw new Error('Backend URL has not been added to config.js.');

    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit',
        body: JSON.stringify({ action, ...payload })
      });

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (_) {
        throw new Error('The backend returned HTML instead of JSON. Confirm that the Apps Script deployment is set to Execute as Me and Who has access is Anyone, then deploy a new version.');
      }

      if (!data.ok) throw new Error(data.error || 'Backend request failed.');
      return data.data;
    } catch (error) {
      if (error && error.message && !/Failed to fetch|Load failed|NetworkError/i.test(error.message)) {
        throw error;
      }
      throw new Error('Could not reach the Apps Script backend. Open the /exec URL directly and confirm it shows version 2.1-current-models. In Apps Script, set Execute as: Me and Who has access: Anyone, then deploy a new version.');
    }
  }

  window.callApi = robustCallApi;
  try { callApi = robustCallApi; } catch (_) {}

  window.setTimeout(function () {
    if (typeof window.initialise === 'function') window.initialise();
  }, 50);
})();
