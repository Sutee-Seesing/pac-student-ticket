# PAC Student Ticket — 99 THB student entitlement

This is a completely separate Thai-first entitlement application for the PAC student offer for **The Burlared (ผู้หญิงอย่างว่า)**.

It is **not** the normal public ticket application. It has its own standalone Apps Script source, Spreadsheet, Drive folders, Script Properties, and Admin token. It does not select performance rounds or consume capacity from the normal 120 THB ticket system.

## Product rules

- Price is fixed at **99 THB** for exactly one admission entitlement.
- One active entitlement per Student ID. `WAITING_REVIEW`, `APPROVED`, and `USED` block another submission.
- A Student ID may submit again only when all previous records are `REJECTED`; the rejected history is retained.
- Eligible IDs are seven digits beginning with `66`, `67`, `68`, or `69` by default.
- Sales are open only from **19 August 2026 09:00:00 through 23:59:59**, `Asia/Bangkok`.
- The server clock is authoritative. A stale browser form cannot submit after the sale window closes.
- Customers upload an RSU Connect screenshot and payment slip. Both are validated server-side and stored in private Drive folders.
- Purchase does not include a performance selection. The venue operator records the actual performance used, if known, from the four configured options.
- There is no quantity selector and no total student-sale capacity limit.

## Repository layout

```text
src/
  Code.gs                 Apps Script service layer and setup()
  Domain.js               Pure business rules, shared by Apps Script and tests
  Index.html              Thai-first customer page
  Admin.html              Protected Thai-first Admin page
  ClientBootstrap.html    Client response validation and UX helpers
  appsscript.json         Apps Script manifest
test/
  domain.test.js          Local business-rule tests
  client-bootstrap.test.js  Static/client contract tests
OPERATOR_GUIDE.md         Thai staff instructions
DEPLOYMENT_GUIDE.md       Owner-only manual deployment instructions
```

## Local tests

Node.js is only used for the pure-rule test suite:

```bash
npm test
```

The Apps Script service layer requires Google Apps Script services and is not executed by Node.

## Owner configuration

Create Script Properties in the **new** standalone Apps Script project only:

| Property | Purpose |
| --- | --- |
| `SPREADSHEET_ID` | New Google Sheet for this application |
| `ADMIN_TOKEN` | New token used only by this Admin page |

The `setup()` function creates `Settings`, `StudentBookings`, and `AuditLog`, plus two new private Drive folders. It is intentionally not called automatically. The owner should run it manually after configuring the new Spreadsheet ID, then fill payment settings in the new `Settings` sheet:

- `BANK_NAME`
- `BANK_ACCOUNT_NUMBER`
- `BANK_ACCOUNT_HOLDER`
- `PROMPTPAY_QR_FILE_ID` (optional image in the new Drive context)
- `SUPPORT_CONTACT`

Do not commit Script Properties, real IDs, tokens, screenshots, slips, or student information.

## Isolation and deployment boundary

This repository must remain independent from `pac-ticket-booking`. Never copy its Script ID, Spreadsheet ID, Admin token, deployment, or booking data. The source contains no production fallback and `spreadsheet_()` refuses to use an active spreadsheet.

Codex does not deploy this application. The owner creates the new Apps Script project and manually performs the final Web App deployment. See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).
