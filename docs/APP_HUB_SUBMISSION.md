# DHIS2 App Hub submission checklist

This document captures everything needed to publish **ISWE Bulk Import/Export**
on the [DHIS2 App Hub](https://apps.dhis2.org/) so it appears in every DHIS2
instance's built-in App Hub browser. Source of truth for the process:
<https://developers.dhis2.org/docs/guides/submit-apphub>.

---

## 1. Prerequisites (one-time)

- [ ] A DHIS2 App Hub account (sign in with GitHub or Google at
      <https://apps.dhis2.org>).
- [ ] An **Organisation** named *ISWE Solutions* registered in App Hub
      (create with the `+` icon next to the organisation dropdown on first
      upload). All future versions are uploaded under this organisation.
- [ ] A contact email the DHIS2 core-review team can reach: **info@iswesolutions.com**.
- [ ] A logo image, **at least 512×512 px**, PNG or JPG, unique and
      licence-clean. (Required.)
- [ ] 3–5 screenshots of the app in use, **1280×800 px recommended**, showing
      real flows (tracker template, validation errors, GeoJSON preview, export
      configuration, results page).

## 2. Verify app is eligible

App Hub reviewers check against three rules (full list in the
[submission guidelines](https://developers.dhis2.org/docs/guides/apphub-guidelines)):

- [x] **Generic** — works on any DHIS2 instance, no hard-coded tenant
      configuration.
- [x] **Open source** — licensed BSD-3-Clause (see [LICENSE](../LICENSE)),
      all runtime dependencies are open source.
- [x] **Useful to a large audience** — bulk import/export is a universal need
      across DHIS2 deployments.

## 3. Build the release artifact

From the repo root:

```bash
yarn install
yarn build
ls -lh build/bundle/
```

This produces `build/bundle/ISWE Bulk Import-Export-<version>.zip`
(the current release is `1.2.6` → `ISWE Bulk Import-Export-1.2.6.zip`,
~1.13 MiB).

> App Hub reads `manifest.webapp` from inside the zip. Our
> [d2.config.js](../d2.config.js) produces one with:
> `name = "ISWE Bulk Import/Export"`, `version = "1.2.6"`,
> `minDHIS2Version = "2.40"`. The App Hub upload form should match.

## 4. Fields to enter in the App Hub upload form

### Basic information

| Field | Value |
| --- | --- |
| App name | `ISWE Bulk Import/Export` (must match `d2.config.js` `name`) |
| Category | `Application` |
| Source code URL | `https://github.com/ISWE-Solutions/iswe-bulk-import-export` |
| Demo URL | *(optional — leave blank unless a public demo instance is available)* |
| Version | `1.2.6` |
| Minimum DHIS2 version | `2.40` |
| Maximum DHIS2 version | *(leave blank — app is forward-compatible with 2.41, 2.42+)* |
| App zip | `build/bundle/ISWE Bulk Import-Export-1.2.6.zip` |

### App description

Paste the description from [d2.config.js](../d2.config.js) (four short
paragraphs covering what it does, what you can import/export, the guided
wizard + smart validation, and the security/compatibility footer).

### Developer

| Field | Value |
| --- | --- |
| Contact email | `info@iswesolutions.com` |
| Organisation | `ISWE Solutions` |

### Images

| Slot | What to upload |
| --- | --- |
| Logo (512×512) | Square logo — reuse `public/icons/dhis2-app-icon.png` at 512 px, or a dedicated mark |
| Screenshot 1 | Home screen tile grid ([docs/images/app-home.jpg](images/app-home.jpg)) |
| Screenshot 2 | Tracker import wizard — program selection |
| Screenshot 3 | Validation preview with "what went wrong" summary panel |
| Screenshot 4 | GeoJSON feature → org-unit matching preview |
| Screenshot 5 | Export configurator / results download |

## 5. Submit and wait for review

1. Click **FINISH** on the upload form.
2. DHIS2 core team reviews (typically a few working days).
3. Feedback arrives by email at the contact address above.
4. On approval, the app becomes visible in every DHIS2 instance's in-app
   App Hub browser under **Apps → Bulk Import/Export**.

## 6. Releasing subsequent versions

After initial approval, the workflow is simpler:

1. Bump the version in [package.json](../package.json) (and
   [d2.config.js](../d2.config.js) implicitly — it reads from package.json).
2. Update [CHANGELOG.md](../CHANGELOG.md).
3. `yarn build`.
4. Sign in to App Hub → **Apps → ISWE Bulk Import/Export → Versions → +**.
5. Upload the new `.zip` with updated min/max DHIS2 version fields.
6. No re-review is required for updates to an already-approved app.

Also cut a matching GitHub release so users installing from source have a
single source of truth:

```bash
gh release create v<version> "build/bundle/ISWE Bulk Import-Export-<version>.zip" \
  --title "v<version>" --notes-file CHANGELOG.md
```

## 7. Common rejection reasons (check before submitting)

- Name in App Hub form doesn't match `name` inside the zip's
  `manifest.webapp`.
- Missing or broken source-code URL.
- Logo below 512 px or not square.
- No screenshots, or screenshots showing a blank app.
- Description is just the name or a single line — must explain what the app
  does, who it's for, and how to use it.
- App embeds a closed-source dependency or calls a proprietary backend.

None of these apply to the current build.
