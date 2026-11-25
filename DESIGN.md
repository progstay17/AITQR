# AITQR — Visual Design System

**Direction:** Modern Blue / Secure Field Utility  
**Mood:** deep navy, electric blue, precise cyan highlights, clean modern typography.  
**Purpose:** mobile-first web/PWA for staff to enter session metadata and display a secure QR to the recording camera.  
**Status:** visual specification only; does not authorize implementation or change security requirements.

## 1. Design intent

AITQR is a focused field tool. Staff should open it on a phone, confirm recording details, generate a QR and present it to a camera in seconds—even in bright field lighting or imperfect connectivity.

It should feel like a premium, trustworthy utility: calm, clear, fast and secure. It must not look like a generic AI SaaS landing page, crypto wallet, sci-fi control panel or analytics dashboard.

Priorities:
1. Correct metadata entry.
2. Unmistakable session and device identity.
3. Large, sharp, camera-readable QR.
4. Security/key failures impossible to overlook.
5. Reliable mobile and supported offline behavior.

## 2. Art direction

### Color tokens

| Token | Hex | Use |
|---|---|---|
| canvas | #071426 | Main dark navy background |
| surface-1 | #0C1D34 | Main panels |
| surface-2 | #102744 | Cards and form groups |
| surface-3 | #173657 | Selected/interactive surfaces |
| line | #244766 | Borders and dividers |
| text-primary | #F1F7FF | Main text |
| text-secondary | #B2C6DC | Supporting text |
| text-muted | #829BB5 | Quiet labels |
| blue-primary | #398BFF | Primary action and active controls |
| blue-bright | #62A8FF | Focus and active accent |
| cyan | #5DE0E6 | Limited technical accent |
| success | #50D6A0 | Ready/persisted/completed |
| warning | #F5C36A | Attention |
| danger | #FF777E | Security or validation failure |

Blue is the main brand color. Cyan is a limited secondary accent. Do not combine every accent in one component. The QR itself is always pure black on pure white.

### Typography

- UI: Inter or system sans-serif.
- IDs, session codes and technical values: IBM Plex Mono or system monospace.
- Body: 15–16 px; labels 13–14 px; helper text 12–13 px.
- Page title 22–26 px; section title 17–19 px.
- Tabular numerals for timestamps and codes.
- No sci-fi fonts, excessive letter spacing or all-uppercase paragraphs.

### Shape and effects

- Cards: 12–18 px radius; inputs/buttons: 10–12 px radius.
- Subtle crisp borders, blue edge lighting and restrained cyan highlights.
- The supplied reference is a visual mood reference, not a page template: borrow deep navy, controlled blue glow, a subtle static geometric/diagonal texture and a short editorial serif-italic accent on the operational home screen.
- Keep decoration low-opacity and behind content. No marketing landing page, decorative particle field, motion/animated grids, glassmorphism or blurred floating dashboards.
- Never place visual effects beneath form controls in a way that harms readability, or over/near the QR quiet zone.

## 3. Mobile-first shell

Design first for 360×800 and 390×844 phones.

Mobile:
- Single-column layout.
- Compact top bar with AITQR mark, connection/offline state and menu.
- Content max width 560 px, centered on larger screens.
- 18–20 px page padding.
- Sticky bottom action only when it does not cover fields or browser controls.
- Respect safe-area insets and virtual keyboard behavior.

Tablet/desktop:
- Center content, max width 720–860 px.
- Two columns only for short, logically related fields.
- QR remains centered and large, never squeezed into a narrow side panel.

## 4. Primary journey

Open → Check device key → Choose profile → Enter details → Review → Generate QR → Show to camera.

This is a workflow, not a dashboard. Use a compact progress indicator only if useful. Prefer one well-structured form over a wizard that adds unnecessary taps.

### Start / readiness

Answer immediately:
- Is the app ready?
- Is the device key present and persisted?
- Is the configuration bundle valid and current?
- Which profile is active?

Show a compact readiness panel, active profile, one obvious Start session action and session history as a secondary entry. States include Ready, Offline — using saved configuration, and a blocking error. No marketing landing page, sales copy, charts or KPI tiles. A compact operational introduction may clarify the next action, but profile selection and readiness remain the primary focus.

### Metadata form

- Group fields into Recording details, Location & activity and Camera.
- Mark required fields; label optional fields.
- Use native select/date/time controls where suitable.
- Never silently carry forward a previous person's identity or activity.
- Searchable lists for long locations/activities.
- Preserve values when returning from review.
- Inline validation gives a clear correction instruction.
- Device ID is selected/scanned/confirmed according to profile contract; never invent it.
- Keep advanced technical fields collapsed unless needed.

The form must not feel like a spreadsheet squeezed onto a phone.

### Review

Show a concise summary:
- Recorder/operator label
- Location and activity
- Camera/device ID
- Date/time and shift
- Profile/version
- Session ID

Actions: Edit details and Generate secure QR. System-derived session ID and device identity are not editable.

### QR display — critical camera-facing screen

The QR screen prioritizes scan reliability over decoration.

- Place QR in a large clean white square with quiet zone of at least four modules.
- QR modules are pure black; background pure white.
- Never apply brand colors, rounded modules, logo, gradients, shadows over the code or decorative corner marks.
- QR occupies roughly 68–82% of available screen width, preserving quiet zone and safe margins.
- Center it; do not let a tall header or explanatory copy compete for space.
- Below it, show session ID in monospace and status such as “QR siap dipindai kamera”.
- Show profile and recorder as compact secondary text.
- Give unobtrusive brightness guidance.
- Request Screen Wake Lock only when supported; explain if screen may dim.
- Offer Back to details and Finish session.
- Never expose private key or raw secret token.
- Re-display from history must be labelled “Tampilkan ulang”; it must not mint a new session.
- Test with the actual camera at real distance and lighting.

Do not add a logo to the QR or put a decorative frame close enough to reduce its quiet zone.

### History

- Local-only by default.
- Show date/time, session ID, profile and status.
- Re-display an existing QR only with clear Tampilkan ulang wording.
- Missing/reset key events must be explicit; never pretend old device identity remains available.
- Store no more personal data than required by profile and retention policy.

### Device key and security status

Use plain language:
- “Identitas perangkat siap” — key exists and is persisted.
- “Perangkat perlu didaftarkan” — show public registration code for administrator.
- “Identitas perangkat direset” — block generation until re-registration if policy requires.
- “Fitur keamanan browser tidak tersedia” — explain missing capability and block generation.

Security failure is not a dismissible minor warning. No silent unsigned fallback.

## 5. Reusable components

MobileAppHeader, ReadinessCard, ProfileCard, FormSection, FieldLabel, TextField, SelectField, DateTimeField, InlineValidation, ReviewSummary, PrimaryAction, SecondaryAction, SecureQRCanvas, SessionCode, KeyStatus, OfflineStatus, HistoryList and BlockingError.

Each component supports relevant focus, disabled, loading, validation and error states.

## 6. Interaction and motion

- Primary action: solid blue with high-contrast text.
- Secondary action: navy surface with border.
- Destructive/session-ending action: visually separated and confirmed only when necessary.
- Persistent labels; placeholder is not a label.
- Validate on blur and before submit; do not clear the form on error.
- Prevent repeated generation taps while pending.
- Revisiting QR screen must not create a new session ID.
- Short 120–180 ms transitions; subtle feedback.
- No perpetual animation. Respect reduced-motion preferences.

## 7. Responsive behavior

- 320–359 px: one column, compact spacing, QR keeps quiet zone.
- 360–430 px: primary target, large touch controls and QR.
- 431–767 px: centered narrow column.
- 768 px+: centered workspace; optional two-column form for related fields.
- QR remains square and uses viewport intelligently.
- No horizontal scrolling; touch targets at least 44×44 px.

## 8. Accessibility and field usability

- Target WCAG 2.2 AA contrast.
- Touch target at least 44×44 px.
- Clear labels, focus order and screen-reader names.
- Associate errors with fields; use plain language.
- Do not rely on color alone for readiness/security.
- Keep copy readable in sunlight; test phone brightness and glare.
- QR white area must not be dimmed by dark-mode overlays or filters.
- Indonesian default; English additional locale.
- Respect browser zoom and dynamic text sizing.

## 9. Security and trust constraints

- Visual design must reinforce architecture, never weaken it.
- Never display private keys, decoder secrets or signing-bundle secrets.
- No silent fallback to unsigned QR.
- If bundle signature, anti-rollback, device key persistence or required crypto capability fails, block generation and explain why.
- Distinguish offline with valid cached configuration from configuration unavailable.
- Device key proves the signing device, not the human operator.
- QR remains high-contrast black-on-white regardless of app theme.
- Do not send form contents to analytics or third-party services.

## 10. Copywriting tone

Use concise, calm and actionable Indonesian:
- “Periksa data sesi” instead of generic marketing slogans.
- “Identitas perangkat siap” instead of vague empowerment language.
- “QR siap dipindai kamera” instead of mission/activation jargon.
- Explain next action and reason for any block.
- Avoid exaggerated words such as revolutionary, magic, next-gen or AI-powered.

## 11. Design acceptance checklist

- [ ] Fast operational entry point, not a marketing dashboard.
- [ ] Modern dark blue identity with restrained cyan.
- [ ] Form is comfortable on 360 px wide phones.
- [ ] QR is pure black on white, large, square and camera-readable.
- [ ] Security/key failures block generation where required.
- [ ] Offline-ready is distinct from broken/untrusted configuration.
- [ ] Session ID and device identity are visible without exposing secrets.
- [ ] Re-displaying an old QR is distinct from creating a new session.
- [ ] No AI-template gradients, glassmorphism, decorative dashboards or fake metrics.
- [ ] Touch targets, contrast, keyboard access and real-camera testing are covered.
