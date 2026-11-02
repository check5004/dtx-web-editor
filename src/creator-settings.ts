/** Creator compatibility metadata. Color indices follow the upstream WRITER's
 * one-based decimal resource IDs; its reader contains an off-by-one defect.
 * Unknown/malformed directives are preserved, never guessed or discarded. */
import { stringChannel, type Project } from "./chart";
export type CreatorBank = "WAV" | "BMP" | "BMPTEX" | "AVI";
export interface CreatorPaletteEntry {
  bank: CreatorBank;
  id: string;
}
export interface CreatorBinding {
  lane: number;
  front: string;
  back: string;
}
export interface ResourceAppearance {
  label: string;
  foreground: string;
  background: string;
  bgm: boolean;
}
export interface CreatorLane {
  index: number;
  name: string;
  front: string;
  back: string;
  bank: CreatorBank | null;
}
const rows: [string, string, string, CreatorBank | null][] = [
  ["BPM", "08", "03", null],
  ["LC", "1A", "1A", "WAV"],
  ["HH", "11", "18", "WAV"],
  ["LP", "1B", "1B", "WAV"],
  ["LB", "1C", "1C", "WAV"],
  ["SD", "12", "12", "WAV"],
  ["HT", "14", "14", "WAV"],
  ["BD", "13", "13", "WAV"],
  ["LT", "15", "15", "WAV"],
  ["FT", "17", "17", "WAV"],
  ["CY", "16", "16", "WAV"],
  ["RD", "19", "19", "WAV"],
  ["FI", "53", "53", null],
  ...["4F", "4E", "4D", "4C"].map(
    (c, i) => [`BN${i + 1}`, c, c, null] as [string, string, string, null],
  ),
  ...[
    ["MLC", "87"],
    ["MHH", "84"],
    ["MCY", "85"],
    ["MRD", "86"],
  ].map(([n, c]) => [n, c, c, "WAV"] as [string, string, string, CreatorBank]),
  ["BGM", "01", "01", "WAV"],
  ...Array.from({ length: 32 }, (_, i) => {
    const c = String(61 + i).padStart(2, "0");
    return [`SE${i + 1}`, c, c, "WAV"] as [string, string, string, CreatorBank];
  }),
  ...["GtV", "GtR", "GtG", "GtB", "GtY", "GtP", "GtW", "GtL"].map(
    (n, i) =>
      [
        n,
        i === 6 ? "28" : i === 7 ? "2C" : "",
        i === 6 ? "28" : i === 7 ? "2C" : "",
        i === 0 ? "WAV" : null,
      ] as [string, string, string, CreatorBank | null],
  ),
  ...["BsV", "BsR", "BsG", "BsB", "BsY", "BsP", "BsW", "BsL"].map(
    (n, i) =>
      [
        n,
        i === 6 ? "A8" : i === 7 ? "2D" : "",
        i === 6 ? "A8" : i === 7 ? "2D" : "",
        i === 0 ? "WAV" : null,
      ] as [string, string, string, CreatorBank | null],
  ),
  ["AVI", "54", "54", "AVI"],
  ...["04", "07", "55", "56", "57", "58", "59", "60"].map(
    (c, i) =>
      [
        `BG${i + 1}`,
        c,
        ["C4", "C7", "D5", "D6", "D7", "D8", "D9", "E0"][i],
        "BMP",
      ] as [string, string, string, CreatorBank],
  ),
];
export const CREATOR_LANES: readonly CreatorLane[] = rows.map(
  ([name, front, back, bank], index) => ({ index, name, front, back, bank }),
);
const idPattern = /^[0-9A-Z]{2}$/;
const validId = (id: string, zero = false) => {
  const x = id.toUpperCase();
  if (!idPattern.test(x) || (!zero && x === "00"))
    throw new Error("ID は 01–ZZ です（未割当は 00）。");
  return x;
};
const normalizedBank = (bank: CreatorBank) =>
  bank === "BMPTEX" ? "BMP" : bank;
const sameBank = (a: CreatorBank | null, b: CreatorBank) =>
  a !== null && normalizedBank(a) === normalizedBank(b);
function editable(p: Project) {
  if (p.readOnlyReason) throw new Error(p.readOnlyReason);
}
function safeLabel(s: string) {
  if (/[\r\n]/.test(s) || s.length > 1000)
    throw new Error("ラベルは改行なしの 1000 文字以内です。");
  return s;
}
const validColor = (s: string) =>
  /^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|[a-z]{1,30})$/i.test(s);
function safeColor(s: string) {
  if (s && !validColor(s))
    throw new Error("色は #RRGGBB または色名で指定してください。");
  return s;
}
const colorLine =
  /^(\s*#DTXC_(WAV|BMP|AVI)(FORECOLOR|BACKCOLOR)\s*:\s*)(\d+)(\s+)([^;\s]+)(.*)$/i;
const bgmLine = /^(\s*#BGMWAV\s*:\s*)([0-9A-Z]{2})(\s*(?:;.*)?)$/i;
const paletteLine = /^(\s*#DTXC_CHIPPALETTE\s*:\s*)([^;]*)(;.*)?$/i;
const bindingLine =
  /^(\s*#DTXC_LANEBINDEDCHIP\s*:\s*)(\d{2})(\s+)([0-9A-Z]{2})(\s+)([0-9A-Z]{2})(\s*(?:;.*)?)$/i;
function validDecimalId(n: number) {
  return Number.isInteger(n) && n >= 1 && n < 1296;
}
export function getResourceAppearance(
  p: Project,
  bank: CreatorBank,
  id: string,
): ResourceAppearance {
  id = validId(id);
  const appearance: ResourceAppearance = {
    label: "",
    foreground: "",
    background: "",
    bgm: false,
  };
  if (bank === "WAV")
    appearance.label = String(
      (p.resources[id] as { label?: string } | undefined)?.label || "",
    );
  else
    for (const line of p.passthrough) {
      const m = line.match(
        new RegExp(`^\\s*#${bank}${id}\\s*:\\s*([^;]*)(?:;(.*))?$`, "i"),
      );
      if (m) appearance.label = m[2]?.trim() || "";
    }
  for (const line of p.passthrough) {
    const c = line.match(colorLine);
    if (
      c &&
      c[2].toUpperCase() === normalizedBank(bank) &&
      Number(c[4]) === parseInt(id, 36)
    ) {
      const value = c[6];
      if (validColor(value))
        appearance[
          c[3].toUpperCase() === "FORECOLOR" ? "foreground" : "background"
        ] = value;
    }
    const b = line.match(bgmLine);
    if (bank === "WAV" && b && b[2].toUpperCase() === id) appearance.bgm = true;
  }
  return appearance;
}
export function setResourceAppearance(
  p: Project,
  bank: CreatorBank,
  id: string,
  patch: Partial<ResourceAppearance>,
): Project {
  editable(p);
  id = validId(id);
  const out = structuredClone(p),
    dec = parseInt(id, 36),
    name = normalizedBank(bank);
  if (patch.label !== undefined) {
    const label = safeLabel(patch.label);
    if (bank === "WAV") {
      if (!out.resources[id]) throw new Error("WAV 定義がありません。");
      Object.assign(out.resources[id], { label });
    } else {
      let found = false;
      out.passthrough = out.passthrough.map((line) => {
        const m = line.match(
          new RegExp(`^(\\s*#${bank}${id}\\s*:\\s*)([^;]*)(?:;.*)?$`, "i"),
        );
        if (!m) return line;
        found = true;
        return m[1] + m[2].trimEnd() + (label ? "\t;" + label : "");
      });
      if (!found) throw new Error("画像・動画の定義がありません。");
    }
  }
  for (const [prop, key] of [
    ["foreground", "FORECOLOR"],
    ["background", "BACKCOLOR"],
  ] as const)
    if (patch[prop] !== undefined) {
      const value = safeColor(patch[prop]!);
      out.passthrough = out.passthrough.filter((line) => {
        const m = line.match(colorLine);
        return !(
          m &&
          m[2].toUpperCase() === name &&
          m[3].toUpperCase() === key &&
          Number(m[4]) === dec &&
          validColor(m[6]) &&
          /^\s*(?:;.*)?$/.test(m[7])
        );
      });
      if (value) out.passthrough.push(`#DTXC_${name}${key}: ${dec} ${value}`);
    }
  if (bank === "WAV" && patch.bgm !== undefined) {
    out.passthrough = out.passthrough.filter((line) => {
      const m = line.match(bgmLine);
      return !(m && m[2].toUpperCase() === id);
    });
    if (patch.bgm) out.passthrough.push(`#BGMWAV: ${id}`);
  }
  return out;
}
export function getCreatorPalette(p: Project): CreatorPaletteEntry[] {
  const entries: CreatorPaletteEntry[] = [];
  for (const line of p.passthrough) {
    const m = line.match(paletteLine);
    if (!m) continue;
    for (const token of m[2].trim().split(/\s+/)) {
      const t = token.match(/^([012]),([0-9A-Z]{2})$/i);
      if (t && t[2] !== "00")
        entries.push({
          bank: (["WAV", "BMP", "AVI"] as CreatorBank[])[Number(t[1])],
          id: t[2].toUpperCase(),
        });
    }
  }
  return entries;
}
/** Preserve malformed palette tokens/comments as a separate original line. */
export function setCreatorPalette(
  p: Project,
  entries: CreatorPaletteEntry[],
): Project {
  editable(p);
  if (entries.length > 3885) throw new Error("パレットが大きすぎます。");
  const out = structuredClone(p);
  out.passthrough = out.passthrough.flatMap((line) => {
    const m = line.match(paletteLine);
    if (!m) return [line];
    const unknown = m[2]
      .trim()
      .split(/\s+/)
      .filter((t) => t && !/^([012]),(?!00)[0-9A-Z]{2}$/i.test(t));
    return unknown.length || m[3]
      ? [m[1] + unknown.join(" ") + (m[3] ? " " + m[3] : "")]
      : [];
  });
  const unique = new Set(
    entries.map(
      (e) =>
        `${{ WAV: 0, BMP: 1, BMPTEX: 1, AVI: 2 }[e.bank]},${validId(e.id)}`,
    ),
  );
  if (unique.size)
    out.passthrough.push("#DTXC_CHIPPALETTE: " + [...unique].join(" "));
  return out;
}
export function getCreatorBindings(p: Project): CreatorBinding[] {
  const map = new Map<number, CreatorBinding>();
  for (const line of p.passthrough) {
    const m = line.match(bindingLine);
    if (m && Number(m[2]) < CREATOR_LANES.length)
      map.set(Number(m[2]), {
        lane: Number(m[2]),
        front: m[4].toUpperCase(),
        back: m[6].toUpperCase(),
      });
  }
  return [...map.values()];
}
export function setCreatorBinding(
  p: Project,
  binding: CreatorBinding,
): Project {
  editable(p);
  if (!Number.isInteger(binding.lane) || !CREATOR_LANES[binding.lane])
    throw new Error("Creator レーン番号が不正です。");
  const front = validId(binding.front, true),
    back = validId(binding.back, true),
    out = structuredClone(p);
  out.passthrough = out.passthrough.filter((line) => {
    const m = line.match(bindingLine);
    return !(m && Number(m[2]) === binding.lane);
  });
  if (front !== "00" || back !== "00")
    out.passthrough.push(
      `#DTXC_LANEBINDEDCHIP: ${String(binding.lane).padStart(2, "0")} ${front} ${back}`,
    );
  return out;
}
/** Rewrite only compatibility metadata. Caller separately moves resources/notes.
 * Mapping is simultaneous, supports swaps, and rejects many-to-one collisions. */
export function remapCreatorReferences(
  p: Project,
  bank: CreatorBank,
  mapping: Record<string, string>,
): Project {
  editable(p);
  const map = new Map(
    Object.entries(mapping).map(([a, b]) => [validId(a), validId(b)]),
  );
  if (new Set(map.values()).size !== map.size)
    throw new Error("同じ ID への重複移動はできません。");
  const out = structuredClone(p),
    mapId = (id: string) => map.get(id.toUpperCase()) || id;
  out.passthrough = out.passthrough.map((line) => {
    const b = line.match(bgmLine);
    if (bank === "WAV" && b) return b[1] + mapId(b[2]) + b[3];
    const c = line.match(colorLine);
    if (
      c &&
      c[2].toUpperCase() === normalizedBank(bank) &&
      validDecimalId(Number(c[4])) &&
      validColor(c[6]) &&
      /^\s*(?:;.*)?$/.test(c[7])
    ) {
      const id = Number(c[4]).toString(36).toUpperCase().padStart(2, "0");
      return (
        c[1] +
        (map.has(id) ? parseInt(map.get(id)!, 36) : c[4]) +
        c[5] +
        c[6] +
        c[7]
      );
    }
    const pal = line.match(paletteLine);
    if (pal) {
      const type = { WAV: "0", BMP: "1", BMPTEX: "1", AVI: "2" }[bank];
      return (
        pal[1] +
        pal[2].replace(/\S+/g, (token) => {
          const match = token.match(/^([012]),([0-9A-Z]{2})$/i);
          return match && match[1] === type
            ? `${match[1]},${mapId(match[2])}`
            : token;
        }) +
        (pal[3] || "")
      );
    }
    const binding = line.match(bindingLine);
    if (
      binding &&
      sameBank(CREATOR_LANES[Number(binding[2])]?.bank ?? null, bank)
    )
      return (
        binding[1] +
        binding[2] +
        binding[3] +
        mapId(binding[4]) +
        binding[5] +
        mapId(binding[6]) +
        binding[7]
      );
    return line;
  });
  return out;
}

/** Voice bindings apply to every fretted/open pattern, not just a single fret channel. */
export function creatorLaneForChannel(channel: string) {
  const info = stringChannel(channel);
  return info && ["note", "open"].includes(info.kind)
    ? CREATOR_LANES.find(
        (l) => l.index === (info.instrument === "guitar" ? 54 : 62),
      )
    : CREATOR_LANES.find((l) => l.front === channel);
}
