# AI arrangement and metadata contract

The client calls OpenRouter only after the user chooses an AI action with their own key. These functions do not persist keys, send audio, or change the chart. The UI must show a payload summary and pricing warning, allow cancellation, and offer review/apply/discard.

## Difficulty

`requestDifficulty(key, model, notes, level, signal?, context?)` produces one proposal. `requestDifficultyVariants(key, model, notes, signal?, context?)` requests easy/normal/hard together in **one** request. Do not call both for one button click. Supply real tempo and measure context, especially for non-4/4 charts:

- `bpm`: initial effective tempo.
- `genre` and `groove`: optional user-supplied style and pulse guidance; never inferred from unheard audio.
- `tempos`: chronological `{ beat, bpm }` changes.
- `measures`: chronological `{ startBeat, length }`, in quarter-note beats, using inherited DTX bar lengths.
- `sections`: optional `{ beat, label }` structural markers.
- `protectedIds`: optional notes which must survive.

The request uses a compact table of short local aliases, beat positions and drum channels. Original app IDs, filenames and non-drum events are not sent. A 10,000-note mocked request/response regression checks that no notes are silently truncated. Output token budgets scale with note count; actual model context/output limits can still reject a long chart, which produces a visible split-section/larger-model error without retry. The model may only select supplied aliases, which map back to original IDs. The client restores BGM, video, guitar/bass and all other non-drum events regardless of the model's selection. It rejects unknown IDs, malformed data, an empty drum arrangement, emptied measures, contradictory simultaneous HH states and more than two hands/two feet. It warns about removed kick/snare events and very fast intervals. Tempo/media/resources must stay in the original project and be copied unchanged when creating a variant. The UI must not treat `keepIds` as a replacement for those project fields.

This is a reduction assistant, not a guarantee of human playability or musical quality. It has no audio input and does not claim to hear the track. Distances between drums, hand assignments, ergonomics, ghost-note importance and individual skill still need audition/review. The local fallback is explicitly marked `source: 'local'`; it is not an AI result. It preserves original offbeat/swing positions without snapping them to a straight grid.

## Metadata and thumbnails

Metadata enables the documented `openrouter:web_search` server tool with Exa, at most two search calls and six total results. This can incur search charges in addition to model usage. If the model does not search or the API gives no citations, the result is `grounded: false` and must not be labelled retrieved/verified information.

Only API `url_citation` annotations form `citations` and `sourceUrls`. Model-supplied source links are ignored. A thumbnail is exposed only if its exact HTTPS image URL is itself an API citation; other proposals are discarded. A cited image is not a license grant or proof of successful download. Never automatically fetch or publish it. Present the source and a deliberate user import choice; browser CORS or image rights may still prevent import. Artist/title/comment remain proposals and must be rendered as text, never HTML.

## Failure and privacy behavior

No automatic retries or model fallback that could spend again. Requests time out after 90 seconds, support AbortSignal, reject structured-output errors/truncation and use sanitized HTTP error messages. Never include keys in exported projects, URLs, telemetry, logs or screenshots. Persistent key storage belongs in the UI only after an explicit storage choice with same-origin/XSS-risk disclosure and an erase action. Imported audio is not sent to OpenRouter by these modules.

## Verification

Twenty-two isolated tests cover original immutability, protected event restoration, swing, malformed IDs, empty charts/bars, impossible limbs, citation trust, unsafe URLs, request schemas, multi-variant validation, HTTP errors and cancellation. `node --import tsx --test tests/ai.test.ts` and isolated strict TypeScript checking passed. Live authenticated OpenRouter invocation, actual provider schema/tool support, returned audio musical quality and external-image downloading have **not** been tested.

## Official reference pages checked 2026-11-02

- https://openrouter.ai/docs/guides/features/server-tools/web-search
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://github.com/OpenRouterTeam/docs/blob/main/api_reference/errors-and-debugging.mdx

Server tools are beta; a provider rejecting the requested capabilities is a visible failure, not grounds to claim the result is grounded or to retry invisibly.
