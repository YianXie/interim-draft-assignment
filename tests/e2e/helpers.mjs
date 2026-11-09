// Shared by every browser test. Collects page errors and CSP violations, with no fixed waits.
export function watchPage(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  return {
    problems,
    // Call before page.goto so the listener is in place for the first load.
    async listenForCsp() {
      await page.addInitScript(() => {
        window.__csp = [];
        document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
      });
    },
    csp: () => page.evaluate(() => window.__csp || []),
  };
}
