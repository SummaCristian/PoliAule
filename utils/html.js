/**
 * utils/html.js — helpers for safely injecting external data into the DOM.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Several parts of the app build HTML strings in template literals and assign
 * them to `element.innerHTML`. If any interpolated value contains characters
 * like `<`, `>`, `"`, or `&`, the browser will parse them as markup, allowing
 * an attacker who controls that value (e.g. via a compromised API response) to
 * inject arbitrary HTML — including <script> tags or event-handler attributes.
 * This is a Cross-Site Scripting (XSS) vulnerability.
 *
 * The two functions below are the only safe way to include external data in an
 * innerHTML template. Import them wherever you build HTML strings from API data.
 *
 * WHAT COUNTS AS "EXTERNAL DATA"
 * --------------------------------
 * - Any field fetched from the GitHub API   (info-page.js)
 * - Any field from classrooms.json / occupation_*.json  (originally from Polimi API)
 * - Any field from the Polimi photo/schedule REST APIs  (classroom-detail.js)
 * - In general: anything that isn't a hardcoded string literal in this codebase.
 *
 * WHAT DOES NOT NEED ESCAPING
 * ----------------------------
 * - Calls to t() — i18n strings come from our own translation tables.
 * - Numbers after .toLocaleString() / .toFixed() — numeric output is safe.
 * - CSS class names and icon names that come from local FEATURE_ICONS / LANG_COLORS
 *   maps keyed on trusted integer IDs or hardcoded strings.
 */

/**
 * Escapes a string for safe interpolation inside an HTML context.
 *
 * Replaces the five characters that have special meaning in HTML/XML with their
 * named entity equivalents so the browser treats them as plain text rather than
 * markup:
 *
 *   &  →  &amp;   (must be first to avoid double-escaping)
 *   <  →  &lt;    (prevents opening a new tag)
 *   >  →  &gt;    (prevents closing a tag)
 *   "  →  &quot;  (prevents breaking out of a double-quoted attribute value)
 *   '  →  &#39;   (prevents breaking out of a single-quoted attribute value)
 *
 * Usage:
 *   element.innerHTML = `<span title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
 *
 * Note: escapeHtml is NOT needed when setting a DOM property directly, e.g.
 *   element.textContent = name;   ← always safe, no HTML parsing happens
 *   img.src = url;                ← safe for src; use safeUrl() for href/action
 */
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Validates that a URL uses the https: scheme before it is placed in a
 * security-sensitive attribute such as `href` or `action`.
 *
 * WHY: a URL value like `javascript:alert(1)` is syntactically valid in an href
 * attribute and will execute as script when the user clicks the link. An attacker
 * who can influence the URL (e.g. via a tampered API response) could use this to
 * run arbitrary code in the page's origin - a classic XSS vector even without any
 * angle brackets.
 *
 * This function rejects anything that isn't an https: URL by returning the safe
 * no-op anchor `'#'` instead. http: is also rejected because the app is served
 * over HTTPS and mixed-content links are misleading at best.
 *
 * Usage:
 *   el.innerHTML = `<a href="${safeUrl(c.html_url)}">...</a>`;
 *
 * Note: safeUrl does NOT replace escapeHtml — the returned string still needs to
 * be escaped if interpolated into an HTML attribute:
 *   `href="${escapeHtml(safeUrl(url))}"` ← correct for arbitrary href values
 * In practice, https: URLs from trusted APIs (GitHub, Polimi) won't contain `"`
 * or `<`, so a bare safeUrl() call is acceptable there, but the belt-and-suspenders
 * form is always correct.
 */
export function safeUrl(url) {
  try {
    return new URL(url).protocol === 'https:' ? url : '#';
  } catch {
    return '#';
  }
}
