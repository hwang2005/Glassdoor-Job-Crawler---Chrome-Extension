chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updatePageCount') {
    console.log('Background nhận được thông điệp updatePageCount, chuyển tiếp đến content script');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Chuyển tiếp thông điệp thất bại:', chrome.runtime.lastError);
          } else {
            sendResponse({ status: 'updated' });
          }
        });
      }
    });
    return true;
  }

  // Handler: open a new tab, wait for it to finish loading, capture final URL, close it
  if (message.action === 'captureNewTab') {
    let captured = false;
    let newTabId = null;

    const onCreated = (tab) => {
      if (!newTabId) {
        newTabId = tab.id;
        console.log('captureNewTab: new tab created, id =', tab.id);
      }
    };

    const onUpdated = (tabId, changeInfo) => {
      if (tabId === newTabId && !captured) {
        // Accept on 'loading' with a URL OR 'complete' – some external sites
        // redirect quickly and we can grab the URL early
        if (changeInfo.url && changeInfo.url !== 'about:blank' && !changeInfo.url.startsWith('chrome://')) {
          finish(changeInfo.url, null);
          return;
        }
        if (changeInfo.status === 'complete') {
          chrome.tabs.get(tabId, (finalTab) => {
            if (chrome.runtime.lastError || !finalTab) {
              finish(null, 'tab_get_error');
              return;
            }
            const url = finalTab.url || '';
            if (!url || url === 'about:blank' || url.startsWith('chrome://')) return;
            finish(url, null);
          });
        }
      }
    };

    function finish(url, error) {
      if (captured) return;
      captured = true;
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (newTabId) {
        chrome.tabs.remove(newTabId, () => {
          if (chrome.runtime.lastError) { /* ignore */ }
          console.log('captureNewTab: closed tab, final URL =', url);
          sendResponse({ url: url, error: error });
        });
      } else {
        sendResponse({ url: url, error: error || 'no_tab' });
      }
    }

    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);

    // Timeout after 5 seconds – external sites are captured in 1-2s; this
    // is generous while still keeping the crawler fast.
    setTimeout(() => {
      if (!captured) {
        console.warn('captureNewTab: timed out after 5s');
        finish(null, 'timeout');
      }
    }, 5000);

    return true; // keep channel open for async sendResponse
  }
});