/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { gZenSecurityWatch } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenSecurityWatch.sys.mjs"
);
const {
  assess,
  compareVersions,
  parseAdvisory,
  parseKnownExploited,
  parseKnownVulnerabilities,
  releasesAfter,
} = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenSecurityFeed.sys.mjs"
);

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {{version: string, id: string, level: string}[]} releases
 * @returns {string} Mozilla's list of advisories, newest release first
 */
function makeVulnerabilitiesPage(releases) {
  return releases
    .map(
      ({ version, id, level }) => `
    <h3 id="firefox${version}" class="level-heading"><a href="#firefox${version}">
      <span class="anchor">#</span> Fixed in Firefox ${version}
    </a></h3>
    <ul>
      <li class="level-item"><a href="/en-US/security/advisories/${id}/">
        <span class="level ${level}">${id.slice(4)}</span>
        Security Vulnerabilities fixed in Firefox ${version}
      </a></li>
    </ul>`
    )
    .join("");
}

/**
 * @param {object} options
 * @param {string} options.announced - As Mozilla writes it: "May 4, 2026"
 * @param {{id: string, level: string, title: string, note: ?string}[]}
 *   options.cves
 * @returns {string} An advisory's page
 */
function makeAdvisoryPage({ announced, cves }) {
  return `
  <div class="advisory">
    <dl class="summary">
      <dt>Announced</dt> <dd>${announced}</dd>
      <dt>Impact</dt> <dd><span class="level high">high</span></dd>
    </dl>
    ${cves
      .map(
        ({ id, level, title, note }) => `
    <section class="cve">
      <h4 id="${id}" class="level-heading">
        <a href="#${id}"><span class="anchor">#</span>${id}: ${title}</a>
      </h4>
      <dl class="summary">
        <dt>Impact</dt> <dd><span class="level ${level}">${level}</span></dd>
      </dl>
      ${note ? `<h5>Description</h5><p>${note}</p>` : ""}
    </section>`
      )
      .join("")}
  </div>`;
}

const dataUrl = (type, text) => `data:${type},${encodeURIComponent(text)}`;

/**
 * Makes the watch read these feeds, as a build based on `version`, and
 * waits for it to have checked them.
 *
 * @param {object} options
 * @param {string} options.version
 * @param {object[]} options.releases - For makeVulnerabilitiesPage
 * @param {object} options.advisory - For makeAdvisoryPage; the same page
 *   stands for every advisory
 * @param {string[]} [options.knownExploited] - CVEs in CISA's catalog
 * @param {number} [options.graceDays]
 */
async function useFeeds({
  version,
  releases,
  advisory,
  knownExploited = [],
  graceDays = 0,
}) {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.security-watch.enabled", false],
      ["zen.security-watch.version-override", version],
      ["zen.security-watch.grace-days", graceDays],
      [
        "zen.security-watch.vulnerabilities-url",
        dataUrl("text/html", makeVulnerabilitiesPage(releases)),
      ],
      [
        "zen.security-watch.advisory-url",
        dataUrl("text/html", makeAdvisoryPage(advisory)),
      ],
      [
        "zen.security-watch.exploited-url",
        dataUrl(
          "application/json",
          JSON.stringify({
            vulnerabilities: knownExploited.map(cveID => ({ cveID })),
          })
        ),
      ],
    ],
  });
  gZenSecurityWatch.init();
  gZenSecurityWatch.resetForTesting();
  await SpecialPowers.pushPrefEnv({
    set: [["zen.security-watch.enabled", true]],
  });
}

/**
 * Answers the watch's question instead of showing it.
 *
 * @param {number} choice - The button to press: 0 continues, 1 postpones
 * @returns {object[]} What was asked, filled in as it happens
 */
function answerPrompts(choice) {
  const asked = [];
  gZenSecurityWatch.confirm = (window, title, body) => {
    asked.push({ title, body });
    return choice;
  };
  return asked;
}

function blockScreen() {
  return document.getElementById("zen-security-block");
}

registerCleanupFunction(async () => {
  await SpecialPowers.popPrefEnv();
  await SpecialPowers.popPrefEnv();
  gZenSecurityWatch.resetForTesting();
});
