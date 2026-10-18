// Runs axe-core against every page linked from the home page, plus each form page after an
// empty submit (so the GOV.UK error summary and error messages are checked too).
//
//   npm run a11y                 # BASE_URL defaults to https://localhost:44398
//
// Automated checks find roughly a third of WCAG issues; see the README for the manual checks that were done.
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = process.env.BASE_URL ?? 'https://localhost:44398';
const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const formPages = ['/text-input/', '/radios/', '/checkboxes/'];

// GOV.UK Frontend's own radios JavaScript sets aria-expanded on a radio that reveals a conditional question.
// ARIA 1.2 doesn't list aria-expanded for role=radio, so axe flags it; this is upstream Design System
// behaviour (identical on GOV.UK), so it is reported as known rather than failing the run.
const isKnownUpstreamIssue = v => v.id === 'aria-allowed-attr' && v.nodes.every(n =>
  n.html.includes('govuk-radios__input') &&
  [...n.failureSummary.matchAll(/not allowed: (aria-[a-z]+)/g)].every(m => m[1] === 'aria-expanded'));

mkdirSync('screenshots', { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
// Component JavaScript failing (e.g. menus, conditional reveals) is an accessibility problem axe won't report.
let jsErrors = [];
page.on('pageerror', err => jsErrors.push(err.message));
page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

await page.goto(baseUrl);
const paths = await page.locator('main a.govuk-link').evaluateAll(links =>
  links.map(a => new URL(a.href).pathname).filter(p => p.startsWith('/') && !p.startsWith('/umbraco')));
const targets = [
  ...['/', ...new Set(paths), '/success/'].map(path => ({ path, label: path })),
  ...formPages.map(path => ({ path, label: `${path} (after empty submit)`, submit: true })),
];

let failures = 0;
for (const { path, label, submit } of targets) {
  jsErrors = [];
  const response = await page.goto(baseUrl + path);
  if (submit) {
    // Disable client-side validation so the server-rendered error state is what gets tested.
    await page.evaluate(() => document.querySelectorAll('form').forEach(f => f.setAttribute('novalidate', '')));
    await page.evaluate(() => { if (window.jQuery) window.jQuery('form').off('submit'); });
    await Promise.all([page.waitForLoadState('load'), page.locator('main form button[type=submit], main form .govuk-button').first().click()]);
  }
  const name = (path.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home') + (submit ? '-errors' : '');
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });

  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  const status = response?.status();
  const errorSummary = submit ? await page.locator('.govuk-error-summary').count() : null;
  const known = results.violations.filter(isKnownUpstreamIssue);
  const violations = results.violations.filter(v => !known.includes(v));
  const ok = violations.length === 0 && status === 200 && jsErrors.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ` +
    `(HTTP ${status}, ${results.passes.length} rules passed${submit ? `, error summary shown: ${errorSummary > 0}` : ''})`);
  for (const v of known) {
    console.log(`  - [known upstream] ${v.id}: aria-expanded on conditional-reveal radio ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
  }
  for (const v of violations) {
    failures++;
    console.log(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} element(s))`);
    for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')}`);
  }
  // WCAG 2.4.2 / GOV.UK pattern: titles say "Error:" only when the page is showing errors.
  const title = await page.title();
  if (Boolean(submit) !== /^Error: (?!Error:)/.test(title)) {
    failures++;
    console.log(`  - [title] unexpected page title: "${title}"`);
  }
  for (const e of jsErrors) {
    failures++;
    console.log(`  - [js-error] ${e.split('\n')[0]}`);
  }
  if (status !== 200) failures++;
}

await browser.close();
console.log(failures === 0 ? '\nNo axe violations or JavaScript errors found (known upstream issues listed above).' : `\n${failures} problem(s) found.`);
process.exitCode = failures === 0 ? 0 : 1;
