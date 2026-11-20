/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Points "what's new" at Metta's release notes instead of Zen's.
//
// The addresses being replaced are in firefox-branding.js, which the build
// generates. Default pref files are read in reverse alphabetical order and
// the last one read wins, so this file's name has to sort before that one.

// Opened in a tab the first time a new build starts.
pref("startup.homepage_override_url", "https://seud.io/metta/releases/");
pref("app.releaseNotesURL", "https://seud.io/metta/releases/");
pref("app.releaseNotesURL.aboutDialog", "https://seud.io/metta/releases/");
// The "updated" notice in the sidebar.
pref("app.releaseNotesURL.prompt", "https://seud.io/metta/releases/");
pref("app.update.url.manual", "https://seud.io/metta/");
pref("app.update.url.details", "https://seud.io/metta/releases/");
