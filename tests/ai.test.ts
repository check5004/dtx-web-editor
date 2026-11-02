import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simplifyMusically,
  validateProposal,
  validateMetadata,
  safeSourceUrl,
  requestDifficulty,
  requestDifficultyVariants,
  requestMetadata,
  type DifficultyNote,
} from "../src/ai.ts";
const notes: DifficultyNote[] = [
  { id: "k", beat: 0, channel: "13", value: "01" },
  { id: "s", beat: 1, channel: "12", value: "02" },
  { id: "h", beat: 0.25, channel: "11", value: "03" },
  { id: "bgm", beat: 0, channel: "01", value: "04" },
];
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const completion = (value: unknown, annotations: unknown[] = []) =>
  json({
    choices: [
      {
        message: { content: JSON.stringify(value), annotations },
        finish_reason: "stop",
      },
    ],
  });
function withFetch(fn: typeof fetch, run: () => Promise<void>) {
  return async () => {
    const old = globalThis.fetch;
    globalThis.fetch = fn;
    try {
      await run();
    } finally {
      globalThis.fetch = old;
    }
  };
}
test("local proposal preserves source timing, structural drums and non-drums without mutation", () => {
  const before = JSON.stringify(notes),
    x = simplifyMusically(notes, "easy");
  assert(x.keepIds.includes("k"));
  assert(x.keepIds.includes("s"));
  assert(x.keepIds.includes("bgm"));
  assert.equal(x.source, "local");
  assert.equal(JSON.stringify(notes), before);
});
test("local reduction preserves swung/offbeat pulse instead of forcing an integer grid", () => {
  const swing: DifficultyNote[] = Array.from({ length: 8 }, (_, i) => ({
    id: `h${i}`,
    beat: Math.floor(i / 2) + (i % 2 ? 2 / 3 : 0),
    channel: "11",
    value: "01",
  }));
  const proposal = simplifyMusically(swing, "normal");
  assert(proposal.keepIds.includes("h1"));
  assert(proposal.keepIds.length > 0);
});
test("AI cannot invent IDs; deduplicates IDs and restores protected non-drums", () => {
  assert.throws(() => validateProposal(notes, { keepIds: ["bad"] }));
  assert.deepEqual(validateProposal(notes, { keepIds: ["k", "k"] }).keepIds, [
    "k",
    "bgm",
  ]);
  const extras = [
    ...notes,
    { id: "bga", beat: 2, channel: "54", value: "01" },
    { id: "guitar", beat: 3, channel: "20", value: "01" },
  ];
  const x = validateProposal(
    extras,
    { keepIds: ["k"] },
    { protectedIds: ["s"] },
  );
  assert.deepEqual(x.keepIds, ["k", "s", "bgm", "bga", "guitar"]);
});
test("rejects empty drum arrangements and entirely removed bars", () => {
  assert.throws(() => validateProposal(notes, { keepIds: [] }));
  assert.throws(() =>
    validateProposal(
      [...notes, { id: "bar2", beat: 4, channel: "12", value: "02" }],
      { keepIds: ["k"] },
    ),
  );
});
test("invalid note shape and malformed AI response are rejected", () => {
  assert.throws(() =>
    validateProposal([{ ...notes[0], beat: Infinity }], { keepIds: ["k"] }),
  );
  assert.throws(() =>
    validateProposal([notes[0], notes[0]], { keepIds: ["k"] }),
  );
  assert.throws(() => validateProposal(notes, []));
  assert.throws(() => validateProposal(notes, { keepIds: "k" }));
  assert.throws(() =>
    validateProposal(notes, { keepIds: ["k"], warnings: [{}] }),
  );
  assert.throws(() =>
    validateProposal(notes, { keepIds: ["k"], title: { inject: true } }),
  );
});
test("impossible simultaneous hands and contradictory HH do not pass validation", () => {
  const hand = ["11", "12", "19"].map((channel, i) => ({
    id: `n${i}`,
    beat: 0,
    channel,
    value: "01",
  }));
  assert.throws(
    () => validateProposal(hand, { keepIds: hand.map((n) => n.id) }),
    /同時打ち/,
  );
  const hh = ["11", "18"].map((channel, i) => ({
    id: `h${i}`,
    beat: 0,
    channel,
    value: "01",
  }));
  assert.throws(
    () => validateProposal(hh, { keepIds: ["h0", "h1"] }),
    /同時打ち/,
  );
});
test("metadata sources come only from API annotations, not model-invented links", () => {
  const result = validateMetadata(
    {
      title: "Song",
      artist: "Artist",
      comment: "",
      sourceUrls: ["https://invented.example/a"],
      thumbnailUrl: "https://invented.example/cover.jpg",
    },
    [
      {
        type: "url_citation",
        url_citation: {
          url: "https://artist.example/song",
          title: "Artist song",
        },
      },
    ],
  );
  assert.deepEqual(result.sourceUrls, ["https://artist.example/song"]);
  assert.equal(result.thumbnailUrl, "");
  assert.equal(result.grounded, true);
  const no = validateMetadata({ title: "Maybe" }, []);
  assert.equal(no.grounded, false);
  assert(no.warnings.length);
});
test("only explicitly cited image URLs become thumbnail proposals", () => {
  const image = "https://artist.example/cover.jpg";
  const r = validateMetadata({ thumbnailUrl: image }, [
    {
      type: "url_citation",
      url_citation: { url: image, title: "Official cover" },
    },
  ]);
  assert.equal(r.thumbnailUrl, image);
});
test("rejects unsafe sources and accepts public HTTPS URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "http://artist.example",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://user:pass@artist.example/a",
    "https://host.internal/a",
    "https://artist.example:8080/a",
  ])
    assert.equal(safeSourceUrl(url), undefined, url);
  assert.equal(
    safeSourceUrl("https://artist.example/song"),
    "https://artist.example/song",
  );
});
test(
  "difficulty request sends schema and timing only, restores BGM, no audio/key in body",
  withFetch(
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.response_format.type, "json_schema");
      assert.equal(body.provider.require_parameters, true);
      assert(!String(init?.body).includes("test-secret"));
      assert(!String(init?.body).includes("value"));
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.context.bpm, 130);
      assert.equal(input.context.measures[0].length, 3);
      return completion({
        title: "Basic",
        rationale: "バックビート維持",
        keepIds: ["0", "1"],
        warnings: [],
      });
    },
    async () => {
      const r = await requestDifficulty(
        "test-secret",
        "model/name",
        notes,
        "easy",
        undefined,
        { bpm: 130, measures: [{ startBeat: 0, length: 3 }] },
      );
      assert(r.keepIds.includes("bgm"));
    },
  ),
);
test(
  "metadata uses bounded actual web search and cited source annotations",
  withFetch(
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.tools[0].type, "openrouter:web_search");
      assert.equal(body.tools[0].parameters.max_uses, 2);
      return completion(
        {
          title: "Found",
          artist: "Artist",
          comment: "",
          thumbnailUrl: "",
          warnings: [],
        },
        [
          {
            type: "url_citation",
            url_citation: {
              url: "https://artist.example/song",
              title: "Source",
            },
          },
        ],
      );
    },
    async () => {
      const r = await requestMetadata(
        "test-secret",
        "model/name",
        "Song",
        "Artist",
        "https://artist.example/song",
      );
      assert(r.grounded);
    },
  ),
);
test(
  "multiple variants validated independently against source in one request",
  withFetch(
    async () =>
      completion({
        easy: { keepIds: ["0"] },
        normal: { keepIds: ["0", "1"] },
        hard: { keepIds: ["0", "1", "2"] },
      }),
    async () => {
      const r = await requestDifficultyVariants(
        "test-secret",
        "model/name",
        notes,
      );
      assert.equal(r.easy.source, "ai");
      assert(r.hard.keepIds.includes("bgm"));
    },
  ),
);
test(
  "HTTP errors have safe actionable messages without echoing private provider content",
  withFetch(
    async () => new Response("test-secret private input", { status: 401 }),
    async () => {
      await assert.rejects(
        requestDifficulty("test-secret", "model/name", notes, "easy"),
        /401/,
      );
      try {
        await requestDifficulty("test-secret", "model/name", notes, "easy");
      } catch (e) {
        assert(!String(e).includes("test-secret"));
      }
    },
  ),
);
test(
  "HTTP 200 error envelope and truncated output are failures",
  withFetch(
    async () => json({ error: { code: 402, message: "private test-secret" } }),
    async () => {
      await assert.rejects(
        requestDifficulty("test-secret", "model/name", notes, "easy"),
        /402/,
      );
    },
  ),
);
test(
  "unsupported/malformed output never silently applies",
  withFetch(
    async () =>
      json({
        choices: [{ message: { content: "not JSON" }, finish_reason: "stop" }],
      }),
    async () => {
      await assert.rejects(
        requestDifficulty("test-secret", "model/name", notes, "easy"),
        /JSON/,
      );
    },
  ),
);
test(
  "pre-aborted request never reaches fetch",
  withFetch(
    async () => {
      throw new Error("unexpected fetch");
    },
    async () => {
      const c = new AbortController();
      c.abort();
      await assert.rejects(
        requestDifficulty("test-secret", "model/name", notes, "easy", c.signal),
        { name: "AbortError" },
      );
    },
  ),
);
test(
  "abort while request is pending propagates and does not retry",
  withFetch(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("cancel", "AbortError")),
        );
      }),
    async () => {
      const c = new AbortController();
      const promise = requestDifficulty(
        "test-secret",
        "model/name",
        notes,
        "easy",
        c.signal,
      );
      c.abort();
      await assert.rejects(promise, { name: "AbortError" });
    },
  ),
);

test(
  "10,000-note chart uses compact aliases without truncation and maps every selected note back",
  withFetch(
    async (_url, init) => {
      const body = JSON.parse(String(init?.body)),
        input = JSON.parse(body.messages[1].content);
      assert.equal(input.notes.length, 10000);
      assert.deepEqual(input.noteColumns, ["id", "beat", "channel"]);
      assert(!String(init?.body).includes("private-long-original-ID"));
      assert.equal(input.context.genre, "jazz");
      assert.equal(input.context.groove, "swing");
      return completion({
        title: "Complete",
        rationale: "",
        keepIds: input.notes.map((n: string[]) => n[0]),
        warnings: [],
      });
    },
    async () => {
      const large = Array.from({ length: 10000 }, (_, i) => ({
        id: `private-long-original-ID-${i}`,
        beat: i,
        channel: "11",
        value: "01",
      }));
      const result = await requestDifficulty(
        "test-secret",
        "model/name",
        large,
        "hard",
        undefined,
        { genre: "jazz", groove: "swing" },
      );
      assert.equal(result.keepIds.length, 10000);
      assert.equal(result.keepIds[9999], large[9999].id);
    },
  ),
);
test("existing rest bars do not cause a false empty-bar rejection", () => {
  const chart = [notes[0], { ...notes[1], beat: 12 }];
  assert.equal(
    validateProposal(chart, { keepIds: ["k", "s"] }).keepIds.length,
    2,
  );
});
test(
  "response length limit refuses partial candidate rather than applying truncated IDs",
  withFetch(
    async () =>
      json({
        choices: [
          {
            message: { content: '{"keepIds":["0"]}' },
            finish_reason: "length",
          },
        ],
      }),
    async () => {
      await assert.rejects(
        requestDifficulty("test-secret", "model/name", notes, "easy"),
        /途中終了/,
      );
    },
  ),
);
test(
  "network failure is sanitized and never includes key",
  withFetch(
    async () => {
      throw new TypeError("test-secret network data");
    },
    async () => {
      await assert.rejects(
        requestDifficulty("test-secret", "model/name", notes, "easy"),
        (e) =>
          e instanceof Error &&
          e.message.includes("通信できません") &&
          !e.message.includes("test-secret"),
      );
    },
  ),
);
test("timeout aborts pending request after the bounded window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const old = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("timeout", "AbortError")),
      );
    });
  try {
    const promise = requestDifficulty(
      "test-secret",
      "model/name",
      notes,
      "easy",
    );
    t.mock.timers.tick(90000);
    await assert.rejects(promise, /90 秒/);
  } finally {
    globalThis.fetch = old;
    t.mock.timers.reset();
  }
});
