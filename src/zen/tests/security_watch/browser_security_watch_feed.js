/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const at = iso => new Date(iso).getTime();

const RELEASES = makeVulnerabilitiesPage([
  { version: "160.0.1", id: "mfsa2026-130", level: "critical" },
  { version: "160", id: "mfsa2026-125", level: "high" },
  { version: "159.0.1", id: "mfsa2026-123", level: "moderate" },
]);

const ADVISORY = makeAdvisoryPage({
  announced: "November 10, 2026",
  cves: [
    {
      id: "CVE-2026-1001",
      level: "high",
      title: "Sandbox escape in the Graphics: Text component",
    },
    { id: "CVE-2026-1002", level: "low", title: "Spoofing &amp; confusion" },
  ],
});

add_task(function test_versions_compare_by_number() {
  Assert.equal(compareVersions("160", "160.0"), 0, "160 is 160.0");
  Assert.greater(compareVersions("160.0.1", "160.0"), 0);
  Assert.less(compareVersions("159.0.2", "160"), 0);
  Assert.greater(compareVersions("160.0", "99.0"), 0, "Not as text");
});

add_task(function test_the_list_of_releases() {
  const releases = parseKnownVulnerabilities(RELEASES);
  Assert.deepEqual(
    releases.map(({ version, advisories }) => [
      version,
      advisories[0].id,
      advisories[0].level,
    ]),
    [
      ["160.0.1", "mfsa2026-130", "critical"],
      ["160", "mfsa2026-125", "high"],
      ["159.0.1", "mfsa2026-123", "moderate"],
    ]
  );
  Assert.equal(
    releases[0].advisories[0].title,
    "Security Vulnerabilities fixed in Firefox 160.0.1"
  );
  Assert.deepEqual(
    releasesAfter(releases, "159.0.1").map(release => release.version),
    ["160", "160.0.1"],
    "Only newer releases, oldest first"
  );
  Assert.deepEqual(releasesAfter(releases, "160.0.1"), []);
  Assert.deepEqual(parseKnownVulnerabilities("<p>Not the page</p>"), []);
});

add_task(function test_an_advisory() {
  const advisory = parseAdvisory(ADVISORY);
  Assert.equal(advisory.announced, at("2026-11-10T00:00:00Z"));
  Assert.equal(advisory.level, "high");
  Assert.ok(!advisory.exploited, "Nothing says it is being exploited");
  Assert.deepEqual(advisory.cves, [
    {
      id: "CVE-2026-1001",
      level: "high",
      title: "Sandbox escape in the Graphics: Text component",
      exploited: false,
    },
    {
      id: "CVE-2026-1002",
      level: "low",
      title: "Spoofing & confusion",
      exploited: false,
    },
  ]);
});

add_task(function test_an_advisory_for_a_bug_under_attack() {
  const advisory = parseAdvisory(
    makeAdvisoryPage({
      announced: "November 17, 2026",
      cves: [
        { id: "CVE-2026-2001", level: "moderate", title: "Minor" },
        {
          id: "CVE-2026-2002",
          level: "critical",
          title: "Use-after-free",
          note: "We are aware of this issue being exploited in the wild.",
        },
      ],
    })
  );
  Assert.equal(advisory.level, "critical", "The worst of its bugs");
  Assert.ok(advisory.exploited);
  Assert.deepEqual(
    advisory.cves.map(cve => cve.exploited),
    [false, true]
  );
});

add_task(function test_what_to_do_about_missing_fixes() {
  const advisory = {
    id: "mfsa2026-125",
    version: "160",
    title: "Fixed in Firefox 160",
    ...parseAdvisory(ADVISORY),
  };
  const announced = advisory.announced;

  Assert.equal(assess({ advisories: [], now: announced }).action, "none");
  Assert.equal(
    assess({ advisories: [advisory], now: announced + DAY, graceDays: 3 })
      .action,
    "notice",
    "A serious fix that has only just come out can wait"
  );
  Assert.equal(
    assess({ advisories: [advisory], now: announced + 4 * DAY, graceDays: 3 })
      .action,
    "prompt",
    "After the grace period it is asked about"
  );
  Assert.equal(
    assess({
      advisories: [{ ...advisory, level: "moderate" }],
      now: announced + 30 * DAY,
    }).action,
    "notice",
    "Lesser fixes are never asked about"
  );

  const known = assess({
    advisories: [advisory],
    knownExploited: parseKnownExploited(
      JSON.stringify({ vulnerabilities: [{ cveID: "cve-2026-1001" }] })
    ),
    now: announced,
    graceDays: 3,
  });
  Assert.equal(known.action, "block", "A bug in CISA's catalog blocks at once");
  Assert.deepEqual(known.exploited, ["CVE-2026-1001"]);
  Assert.ok(known.advisories[0].cves[0].exploited);

  Assert.deepEqual(
    assess({
      advisories: [{ ...advisory, exploited: true }],
      now: announced,
    }).exploited,
    ["mfsa2026-125"],
    "An advisory can say so without naming the bug"
  );
});
