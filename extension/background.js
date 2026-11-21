// Clicking the toolbar icon opens the side panel, which runs the debate loop.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
