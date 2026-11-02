# Verification record

Release candidate checked on 2026-11-02. This is evidence, not a claim of complete behavioral equivalence with every historical Creator build.

- `npm test`: 231 deterministic tests pass, none fail or skip. Includes format/edit/encoding/timeline, guarded imports/ZIP, sound-kit hashes, local transport/mocks, BGA transforms, AI proposal validation, MIDI device/profile resolution, beat estimation, and DOM integration for MIDI/beat review dialogs.
- `npm run build`: TypeScript and Vite production build pass.
- Independent codec probes: inherited measure lengths, four cymbals, fractional/base BPM, opaque directives/media roundtrip, and 160 forward/inverse tempo-map samples pass.
- `npm audit --omit=dev`: zero known runtime advisories reported at verification time.
- Actual Chromium UI checks by independent reviewer: playback timer/playhead, RC placement with automatic matching WAV, Undo, settings warning; real exported CP932 chart+assets ZIP verified CRC-clean with every WAV reference resolving and FluidR3 license included.
- Actual long-chart import: 1001 bars including A00, inherited 3/4 timing, 5 notes / 2001 seconds; visible canvas buffer remains viewport-sized (342px), UI responds.
- Browser audio OfflineAudioContext harness: kit signal, gain and pan checks; no live device required. Temporary harness files are excluded from release.

- Actual Chromium local beat-assist flow: owned 15-second click WAV, 120 BPM and .25-second onset; analysis ranked 120.00 BPM (score .83), review anchors 0/.25 and 4/2.25, explicit Apply set offset .25, Undo restored 0.
- Actual Chromium hostile manifest check: string-valued WAV volume rejected with a finite-range error and the existing 1001-bar project preserved.
- Actual Chromium MIDI settings: dialog opens without automatically requesting device permission; explicit connection and device/profile controls present.
- YouTube no-callback regression: chart clock/audio wait for official PLAYING state; 12-second watchdog remains paused with recovery advice. Actual Chromium blocked-video recheck passed: Play showed `YouTube · waiting` with clock 00:00.000; after 12 seconds an actionable timeout appeared, clock stayed 00:00.000 and the control returned to 再生. Real video delivery remained unavailable, so successful streaming playback is not claimed.

- Actual Chromium project archive roundtrip: six-entry full project ZIP restored the reference audio, 5 notes and 1001 bars; browser reload retained the same project and reference.

## Not established here

- Windows DTXManiaNX gameplay or pixel-identical video rendering.
- Physical MIDI drum devices, device-specific HH CC behavior, audio-interface latency.
- A paid live OpenRouter request, provider-specific model quality/billing/CORS, or live YouTube timing across all embed policies.
- Exhaustive human acceptance of every browser control, unusual codec, or long listening session. See [the parity matrix](../documentation/creator-parity.md) for remaining acceptance boundaries.

No imported user music, user API keys, browser storage dumps, or private project fixtures are included in the source release.
