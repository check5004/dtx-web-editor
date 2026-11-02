# Bundled MIDI-rendered drum sounds

These are genuine sampled General MIDI percussion, rendered offline from **FluidR3Mono GM 2.312**. They are separate from the application's original procedural fallback sounds. MIDI is note/control data, not an audio recording format: this bank supplies the audio that those note numbers select.

## Source and permission

- Upstream distributor: MuseScore, tag `v2.3.2`, commit `45924076871483cb96b859cc374c5fbdbf76ba53`.
- [Exact SoundFont source](https://github.com/musescore/MuseScore/blob/45924076871483cb96b859cc374c5fbdbf76ba53/share/sound/FluidR3Mono_GM.sf3)
- [Exact bank license](https://github.com/musescore/MuseScore/blob/45924076871483cb96b859cc374c5fbdbf76ba53/share/sound/FluidR3Mono_License.md)
- SoundFont SHA-256: `cfcd66d89e8386823400eca64934b14fbea7bf48ba1f00d21189af1262794ec2`.
- The license explicitly covers **this mono SoundFont**, not merely its synthesizer software. It permits redistribution/modification under MIT with notices. All upstream acknowledgments and full permission text are in `LICENSE.txt` (converted from Windows-1252 to UTF-8, wording preserved).
- Include `LICENSE.txt` and `manifest.json` whenever redistributing these WAV files, including an exported chart package. The application loader returns these attribution files along with the selected kit.

## Rendering and sound distinctions

`manifest.json` records the renderer version, MIDI bank/program/note/velocity, source hash, per-file hash, duration and peak. Bank 128; MIDI channel 10; velocity 100; programs 0 (Standard), 24 (Electronic), 32 (Jazz), numbered from zero. These are the bank's own programs, not genre labels pasted onto the same procedural kit.

13 samples per kit: closed hi-hat 42; open hi-hat 46; pedal 44; snare 38; bass drums 36/35; toms 50/47/41; left crash 57; right crash 49; ride 51; ride bell 53. Open HH is an alternate hit on DTX's HH lane (channel 18); ride bell is an alternative sound on the ride lane, not a new DTX lane.

44.1 kHz, 16-bit PCM, mono. FluidSynth reverb and chorus are off. Stereo renderer output is averaged to mono. One gain is shared across all hits and kits to bring the largest peak to 0.92, preserving relative loudness and transients without clipping or compression. Natural tails are retained through the last sample above -75 dBFS plus 50 ms; rendering reserves 12 seconds per hit. This is a single velocity layer, not a full expressive multi-velocity instrument.

Only the selected kit is fetched from this application's own host. The entire 14.56 MB SoundFont is not downloaded by the browser or bundled. All 39 WAVs total approximately 6.9 MB; long cymbal tails account for most of that. Exported charts use these ordinary WAV files, not a web-only synthesizer.

## Regeneration

Use the checked-in `scripts/render-fluid-kit.py` with Python 3 and an installed FluidSynth shared library. Supply the exact source SF3 above and an output directory. It checks the source hash before rendering. FluidSynth version and floating-point differences can affect output hashes; regenerate/review `manifest.json` and `src/kits.ts` together if changing renders. No upstream implementation or third-party executable is copied into the project.
