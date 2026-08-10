/* MAILO Version 64 */
(() => {
  const applyVersion = () => {
    document.querySelectorAll('#versionBadge,.version-badge').forEach(node => {
      node.textContent = 'Version 64';
    });
  };

  applyVersion();
  new MutationObserver(applyVersion).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
