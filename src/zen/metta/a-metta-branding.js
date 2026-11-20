/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Defaults that Metta changes and that cannot go in prefs/zen: they replace
// values from firefox-branding.js, which the build generates, or from Zen's
// own pref files, which are best left as upstream has them.
//
// Default pref files are read in reverse alphabetical order and the last one
// read wins, so this file's name has to sort before firefox-branding.js.

// Point "what's new" at Metta's release notes instead of Zen's.

// Opened in a tab the first time a new build starts.
pref("startup.homepage_override_url", "https://seud.io/metta/releases/");
pref("app.releaseNotesURL", "https://seud.io/metta/releases/");
pref("app.releaseNotesURL.aboutDialog", "https://seud.io/metta/releases/");
// The "updated" notice in the sidebar.
pref("app.releaseNotesURL.prompt", "https://seud.io/metta/releases/");
pref("app.update.url.manual", "https://seud.io/metta/");
pref("app.update.url.details", "https://seud.io/metta/releases/");

// Zen turns its experiments on in every build that is not its own release,
// which includes this one. This one, a dot under an Essential whose title
// starts with a count, follows whatever the site puts in its title.
pref("zen.theme.essentials-unread-dot", false);
