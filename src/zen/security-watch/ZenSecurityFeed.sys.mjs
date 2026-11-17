// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Reads the public feeds that say which security fixes a Firefox version is
 * missing: Mozilla's list of advisories per release, each advisory's page,
 * and CISA's catalog of vulnerabilities known to be exploited.
 *
 * Everything here is plain parsing, with no access to the browser, so it
 * can be tested on its own.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** From least to most serious. */
export const LEVELS = ["none", "low", "moderate", "high", "critical"];

// How Mozilla words an advisory for a bug that is already being used.
const EXPLOITED_PATTERN =
  /exploited in the wild|being exploited|attacks in the wild|actively exploited|abused in the wild/i;

/**
 * @param {string} level
 * @returns {number} Its place in LEVELS, with unknown levels as "none"
 */
function rank(level) {
  // Old advisories say "medium" for what is now "moderate".
  const index = LEVELS.indexOf(level === "medium" ? "moderate" : level);
  return Math.max(index, 0);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string} The more serious of two levels
 */
export function worse(a, b) {
  return rank(a) >= rank(b) ? LEVELS[rank(a)] : LEVELS[rank(b)];
}

/**
 * Compares release versions such as "160.0" and "160.0.1". Missing parts
 * count as zero, so "160" equals "160.0".
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} Negative, zero or positive, as for a sort
 */
export function compareVersions(a, b) {
  const parts = version =>
    String(version)
      .split(".")
      .map(part => parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) {
      return difference;
    }
  }
  return 0;
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function textOf(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads Mozilla's "known vulnerabilities" page for Firefox.
 *
 * @param {string} html
 * @returns {{version: string, advisories: {id: string, level: string,
 *   title: string}[]}[]} The advisories fixed in each release
 */
export function parseKnownVulnerabilities(html) {
  const releases = [];
  const sections = html.split(/<h3\s+id="firefox(?=[\d.]+")/i).slice(1);
  for (const section of sections) {
    const version = section.match(/^([\d.]+)"/)?.[1];
    // A section ends where its list does.
    const list = section.slice(0, section.search(/<\/ul>/i) >>> 0);
    const advisories = [];
    const item =
      /<a\s+href="[^"]*\/(mfsa\d{4}-\d+)\/?"[^>]*>\s*<span\s+class="level\s+(\w+)"[^>]*>[^<]*<\/span>([\s\S]*?)<\/a>/gi;
    for (const [, id, level, title] of list.matchAll(item)) {
      advisories.push({
        id: id.toLowerCase(),
        level: LEVELS[rank(level.toLowerCase())],
        title: textOf(title),
      });
    }
    if (version && advisories.length) {
      releases.push({ version, advisories });
    }
  }
  return releases;
}

/**
 * Reads one advisory's page.
 *
 * @param {string} html
 * @returns {{announced: ?number, level: string, exploited: boolean,
 *   cves: {id: string, level: string, title: string,
 *   exploited: boolean}[]}}
 */
export function parseAdvisory(html) {
  const [summary, ...sections] = html.split(/<section\s+class="cve"/i);
  const announcedText = summary.match(
    /<dt>\s*Announced\s*<\/dt>\s*<dd>([^<]+)<\/dd>/i
  )?.[1];
  const announced = announcedText
    ? Date.parse(`${announcedText.trim()} UTC`)
    : NaN;
  let level =
    LEVELS[
      rank(
        summary
          .match(
            /<dt>\s*Impact\s*<\/dt>\s*<dd>\s*<span\s+class="level\s+(\w+)"/i
          )?.[1]
          ?.toLowerCase()
      )
    ];
  // A note above the list of bugs applies to the advisory as a whole.
  const header = summary.slice(summary.search(/class="advisory"/i) >>> 0);
  let exploited = EXPLOITED_PATTERN.test(textOf(header));

  const cves = [];
  for (const section of sections) {
    const body = section.slice(0, section.search(/<\/section>/i) >>> 0);
    const id = body.match(/<h4\s+id="(CVE-\d{4}-\d+)"/i)?.[1];
    if (!id) {
      continue;
    }
    const heading = textOf(body.match(/<h4[\s\S]*?<\/h4>/i)?.[0] ?? "");
    const cve = {
      id: id.toUpperCase(),
      level:
        LEVELS[rank(body.match(/class="level\s+(\w+)"/i)?.[1]?.toLowerCase())],
      title: heading.replace(/^#?\s*CVE-\d{4}-\d+:?\s*/i, ""),
      exploited: EXPLOITED_PATTERN.test(textOf(body)),
    };
    level = worse(level, cve.level);
    exploited ||= cve.exploited;
    cves.push(cve);
  }
  return {
    announced: Number.isNaN(announced) ? null : announced,
    level,
    exploited,
    cves,
  };
}

/**
 * @param {string|object} catalog - CISA's catalog, as JSON
 * @returns {Set<string>} The CVEs in it
 */
export function parseKnownExploited(catalog) {
  const data = typeof catalog === "string" ? JSON.parse(catalog) : catalog;
  return new Set(
    (data?.vulnerabilities ?? [])
      .map(entry => String(entry.cveID ?? "").toUpperCase())
      .filter(Boolean)
  );
}

/**
 * @param {{version: string}[]} releases - From parseKnownVulnerabilities
 * @param {string} current - The Firefox version this build is based on
 * @returns {object[]} The releases newer than it, oldest first
 */
export function releasesAfter(releases, current) {
  return releases
    .filter(release => compareVersions(release.version, current) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Decides how to respond to the fixes a build is missing.
 *
 * @param {object} options
 * @param {{id: string, version: string, title: string, level: string,
 *   announced: ?number, exploited: boolean, cves: object[]}[]}
 *   options.advisories - The advisories fixed in newer releases
 * @param {Set<string>} [options.knownExploited] - From parseKnownExploited
 * @param {number} options.now
 * @param {number} [options.graceDays] - Days a fix may be out before its
 *   absence is worth interrupting for. Exploited bugs get no grace.
 * @returns {{action: "none"|"notice"|"prompt"|"block", level: string,
 *   advisories: object[], exploited: string[]}}
 */
export function assess({
  advisories,
  knownExploited = new Set(),
  now,
  graceDays = 0,
}) {
  let level = "none";
  let due = false;
  const exploited = new Set();
  const marked = advisories.map(advisory => {
    const cves = advisory.cves.map(cve => {
      const isExploited = cve.exploited || knownExploited.has(cve.id);
      if (isExploited) {
        exploited.add(cve.id);
      }
      return { ...cve, exploited: isExploited };
    });
    // An advisory can say it is exploited without naming which bug.
    if (advisory.exploited && !cves.some(cve => cve.exploited)) {
      exploited.add(advisory.id);
    }
    level = worse(level, advisory.level);
    const serious = rank(advisory.level) >= rank("high");
    // Without a date, assume it has been out long enough.
    const age =
      advisory.announced === null ? Infinity : now - advisory.announced;
    if (serious && age >= graceDays * MS_PER_DAY) {
      due = true;
    }
    return { ...advisory, cves };
  });

  let action = "none";
  if (exploited.size) {
    action = "block";
  } else if (due) {
    action = "prompt";
  } else if (marked.length) {
    action = "notice";
  }
  return { action, level, advisories: marked, exploited: [...exploited] };
}
