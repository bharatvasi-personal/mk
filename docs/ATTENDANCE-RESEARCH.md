# Time & Attendance for Indian SMEs — options, and what we designed for

Module 6 asked for research before design. Hardware is **not** being installed at launch; the point of
this document is to make sure the data model and API we build now can absorb any of these later
without a redesign. Prices are indicative Indian market rates as of 2026 and should be re-quoted.

## What small food businesses in India actually use

### 1. Paper register
Still the most common at this size. A notebook, signed in and out.
**Cost** ₹20. **Reality** unverifiable, retro-edited, useless for payroll disputes, and the reason wage
arguments happen. It is the baseline we are replacing.

### 2. Fingerprint biometric terminal — the SME default
eSSL (X990, K30), Realtime (T502), Mantra (MFSTAB), Secureye. ₹3,500–8,000 per device.
Wall-mounted, Wi-Fi or LAN or a USB stick for logs. Most expose either a **Push SDK (HTTP POST of punch
events to a configured URL)** or a pull API/ADMS protocol; the cheap ones only export CSV.

**Pros** cheap, no consumable, staff cannot lend a fingerprint to a colleague, near-universal familiarity.
**Cons** fails on wet, floury, oily or cut fingers — which is *every kitchen hand, every shift*. Expect a
10–20% daily failure rate in a kitchen and plan a manual override path. Shared-terminal hygiene is also a
real objection post-2020.

**Verdict for MithilaKitchen:** good for the manager and counter staff, poor for the chef and helpers.
Never make it the only path.

### 3. RFID / NFC card or fob punch
13.56 MHz MIFARE cards, or a DIY ESP32 + PN532 reader (~₹1,200 all-in) posting JSON over Wi-Fi.
Commercial readers ₹2,500–6,000. Cards ₹15–30 each.

**Pros** works with wet and oily hands — the decisive advantage in a kitchen. Instant, hygienic, dirt
cheap to replace. A DIY ESP32 unit is trivially easy for a DevOps partner to flash and is fully under
your control.
**Cons** **buddy punching** — one person can carry three cards. Mitigate with a camera snapshot on punch,
or by pairing the card with a PIN, or by having the manager sight the floor at shift start.

**Verdict:** this is the right primary rail for a kitchen. Our `EmployeeCredential` model stores a card
UID today so cards can be issued and tested before any reader exists.

### 4. Geofenced mobile punch
Employee's own phone, GPS-fenced to the shop, often with a selfie. This is what the modern Indian HR SaaS
products (Keka, Zoho People, greytHR, Kredily, Pagarbook, Salarybox) all lean on.

**Pros** zero hardware, works for a manager visiting a vendor or a future delivery rider, gives you a
photo and a location for free.
**Cons** assumes every helper has a smartphone with data and is willing to install an app — often false
at this wage level. GPS drift in a 12x18 ft shop between neighbouring units is real; use a generous
radius (75–100 m) and treat the fence as advisory, flagged for review, not as a hard reject.

**Verdict:** right for partners, managers and future delivery staff. Not a substitute for a shared
terminal for kitchen staff.

### 5. Shared-device QR / PIN punch — **what we ship on day one**
A QR code printed and taped to the wall encodes a short-lived, rotating token. Staff scan it with any
phone camera and tap their name + 4-digit PIN; or the manager taps a name on the shop tablet.

**Pros** **zero hardware cost, works on 15 Oct.** Rotating token stops someone photographing the QR and
punching from home. Manager-tap mode works even for staff with no phone at all.
**Cons** no biometric proof of identity. Acceptable in a 3–6 person shop where the manager can see
everyone.

**Verdict:** the correct launch choice. Cheap, immediate, and it lets us prove the whole
punch → attendance-day → payroll pipeline with real data before spending a rupee on hardware.

### 6. Full HR SaaS
Keka / greytHR / Zoho People: ₹50–120 per employee per month, or Pagarbook/Salarybox free tiers aimed at
exactly this segment.

**Verdict:** rejected, but for a specific reason rather than cost. Attendance here is not a standalone
problem — it feeds **payroll**, which feeds **staff cost %**, which is one of the two numbers that decide
whether this business works. Splitting it into a separate SaaS means CSV exports forever and no live staff
cost in the daily report. Pagarbook remains a sensible manual fallback if our module ever fails.

## Indian compliance context that shapes the model

- **Shops & Establishments Act (Telangana)** — attendance and wage registers must be maintained and
  produced on inspection; digital records are accepted. Retain for 3 years. Our audit log and immutable
  punch events satisfy this better than a notebook does.
- **Payment of Wages Act** — wages by the 7th (under 1,000 employees). Your stated 10th is late; either
  move it to the 7th or be aware of the exposure. Flagged, not silently accepted.
- **Overtime** — beyond 8 h/day or 48 h/week attracts overtime at twice the ordinary rate. The model
  computes `overtimeMinutes` from day one so you are not reconstructing it later.
- **EPF** applies at 20+ employees, **ESI** at 10+ (Telangana). Not applicable at 3–6 staff, but
  `SalaryStructure` carries the component breakdown so registration later does not mean re-entering history.
- **Aadhaar-based biometric attendance** is legally fraught for private employers — do not store Aadhaar
  numbers or Aadhaar-linked biometric templates. Our schema deliberately has no field for either.

## What this means for the design

The insight that drives the data model: **a punch is a raw, immutable, low-trust event; an attendance day
is a derived, reviewable, correctable record.** Almost every cheap attendance product conflates the two,
and that is why they cannot cope with a missed punch, a device clock skew, or a night shift.

So:

1. **`AttendanceEvent` is append-only and never edited.** It records `source`
   (`MANUAL`, `QR`, `PIN`, `NFC`, `BIOMETRIC`, `MOBILE_GEO`, `WEB`), `direction` (`IN`/`OUT`), the device
   that reported it, `recordedAt` vs `occurredAt` (so an offline reader can backfill honestly), optional
   lat/lng/accuracy, an optional photo key, and a raw payload blob. A correction is a new event with
   `correctsEventId` and a reason, never an update.
2. **`EmployeeCredential`** holds whatever identifies a person to a device: a card UID, a PIN hash, a
   device id, or an opaque vendor template reference. Multiple credentials per employee, each independently
   revocable. Issuing NFC cards later adds rows, not columns.
3. **`AttendanceDevice`** exists now with a shared secret. Any future reader authenticates with an HMAC
   over the payload and a nonce, hitting the same `POST /attendance/punch` the QR screen already uses.
   **The hardware integration is an authentication adapter, not a new module.**
4. **`AttendanceDay`** is the derived record: first in, last out, worked minutes, break minutes, overtime
   minutes, late minutes, status (`PRESENT`, `ABSENT`, `HALF_DAY`, `WEEKLY_OFF`, `HOLIDAY`, `LEAVE`,
   `NEEDS_REVIEW`), and an approval by the manager. It is recomputed idempotently from the event stream,
   so backfilling a week of missed punches from a CSV just works.
5. Payroll consumes `AttendanceDay`, never raw events, and an approved `PayrollRun` **freezes** the days it
   paid so history cannot shift under a paid payslip.

Net effect: on 15 Oct you punch with a QR code and a tap. In phase 3 you screw an ESP32 reader to the wall,
register it as an `AttendanceDevice`, issue cards as `EmployeeCredential` rows, and nothing else in the
system changes.
