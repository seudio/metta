<!--
   - This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/.
   -->
<img src="./configs/branding/metta/logo128.png" width="100px" align="left">

### `Metta`

Metta is a personal build of [Zen Browser](https://github.com/zen-browser/desktop), which is itself based on Firefox. It tracks Zen and adds a few features on top. It is not affiliated with or supported by the Zen team; please do not report Metta problems to them.

<br clear="left">

### What Metta adds

- **Auto Archive** — tabs nobody has used for a while are unloaded, then closed and kept in an archive in the Library, from where they reopen in the space and container they came from. Spaces can opt out, and the archive syncs between devices.
- **Join button for meetings** — give Metta the private iCal address of your calendars and a card appears in the sidebar shortly before a video meeting starts, with a button that opens the call.
- **Its own name, icon and bundle id** (`app.zen-browser.metta`), so it installs next to Zen.

### Versions

Metta `1.24.1b` is built on Zen `1.24.1b` and Firefox `159.0.1`.

### Branches

- `dev` — the default branch: Zen plus Metta's features and branding. Builds come from here.
- `personal-build` — where the build is prepared; kept equal to `dev`.
- `feature/auto-archive`, `feature/meeting-links` — each feature on its own, without the branding, on top of Zen.

Zen is the `upstream` remote (`https://github.com/zen-browser/desktop.git`). New Zen changes are merged from `upstream/dev` into the feature branches and then into `dev`.

### Building on macOS

```sh
npm install
npm run init                       # download Firefox, apply the patches, bootstrap
npm run surfer -- set brand metta
npm run build
(cd engine && ./mach package)      # creates the DMG in engine/obj-*/dist
```

After merging from Zen, run `npm run import` again so new files are linked into `engine/`.

To use the 1Password browser integration the app must be signed with a Developer ID certificate:

```sh
cd engine
./mach macos-sign -a /path/to/a/copy/of/Metta.app \
  -s "Developer ID Application: <name> (<team id>)" \
  -e production-without-restricted -c release
```

Metta has no update server of its own. Turn updates off so it does not ask Zen's:

```sh
defaults write app.zen-browser.metta EnterprisePoliciesEnabled -bool TRUE
defaults write app.zen-browser.metta DisableAppUpdate -bool TRUE
```

### License

Metta is distributed under the [Mozilla Public License 2.0](./LICENSE), like Zen and Firefox. All credit for the browser itself goes to the [Zen](https://zen-browser.app) and Mozilla contributors.
