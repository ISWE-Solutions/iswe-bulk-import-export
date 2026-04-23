# Security Policy

## Supported versions

We fix security issues on the **latest minor release**. Older releases may
receive fixes at the maintainers' discretion.

| Version | Supported |
| ------- | --------- |
| 1.2.x   | ✅        |
| < 1.2   | ❌        |

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security problems.

Instead, report privately via one of:

- GitHub's [Private vulnerability reporting](https://github.com/ISWE-Solutions/iswe-bulk-import-export/security/advisories/new)
  (preferred)
- Email **info@iswesolutions.com** with the details below

Include, where possible:

- A description of the issue and its impact
- Steps to reproduce (proof of concept, affected DHIS2 version, browser)
- Any suggested mitigation

We will acknowledge receipt within **3 business days**, keep you informed of
progress, and credit you in the release notes unless you request otherwise.
Please give us reasonable time to ship a fix before public disclosure
(typically 30–90 days, depending on severity).

## Scope

This app runs entirely in the user's browser inside a DHIS2 instance and uses
the logged-in user's session. It never stores credentials and never sends data
to third-party services. Reports most relevant to us:

- XSS or HTML injection through imported file content
- Bypass of DHIS2 user scopes / org-unit access when building payloads
- Data leakage across users or organisation units
- Arbitrary file read/write via template download or upload paths
- Supply-chain issues affecting our dependencies

Out of scope: issues in the underlying DHIS2 server (report those to the
[DHIS2 team](https://dhis2.org/contact/)), and issues in third-party packages
that are already publicly disclosed without a viable fix path.
