chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "safe-ticket-fetch") {
    return undefined;
  }

  const { url, init } = message;

  fetch(url, init)
    .then(async (response) => {
      const body = await response.text();
      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body,
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        status: 0,
        statusText: "NETWORK_ERROR",
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});
