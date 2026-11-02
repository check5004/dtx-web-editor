/** Legacy conversion follows DTXCreator CDTXInputOutput.cs (NX 9cdabe2). */
import { parseDTX, decodeBar, encodeBar, type Project } from "./chart.js";
export type LegacyFormat = "gda" | "g2d" | "bms" | "bme";
const SE_CHANNELS = [
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "67",
  "68",
  "69",
  "70",
  "71",
  "72",
  "73",
  "74",
  "75",
  "76",
  "77",
  "78",
  "79",
  "80",
  "81",
  "82",
  "83",
  "84",
  "85",
  "86",
  "87",
  "88",
  "89",
  "90",
  "91",
  "92",
];
export const GDA_CHANNELS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {
    TC: "03",
    BL: "02",
    GS: "29",
    DS: "30",
    FI: "53",
    HH: "11",
    SD: "12",
    BD: "13",
    HT: "14",
    LT: "15",
    CY: "16",
    GW: "28",
    BW: "A8",
  };
  for (let i = 0; i < 8; i++) {
    map[`G${i}`] = (0x20 + i).toString(16).toUpperCase();
    map[`B${i}`] = (0xa0 + i).toString(16).toUpperCase();
  }
  SE_CHANNELS.forEach(
    (channel, i) =>
      (map[(i + 1).toString(16).toUpperCase().padStart(2, "0")] = channel),
  );
  return map;
})();
const KEYS: Record<"bms" | "bme", string[]> = {
  bms: ["11", "12", "13", "14", "15", "16", "53"],
  bme: ["1A", "11", "12", "13", "14", "16", "53", "15", "17"],
};
/** Imports ordinary GDA/G2D/BMS/BME charts to editable DTX. Advanced ambiguous constructs remain protected. */
export function parseLegacyChart(text: string, format: LegacyFormat): Project {
  if (!["gda", "g2d", "bms", "bme"].includes(format))
    throw new Error("未対応の旧譜面形式です。");
  const isBMS = format === "bms" || format === "bme",
    converted: string[] = [],
    issues: string[] = [],
    lengthBars = new Set<number>(),
    bgmCounts = new Map<number, number>();
  let maxBar = 0;
  const warn = (reason: string) => {
    if (!issues.includes(reason)) issues.push(reason);
  };
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const row = raw.match(/^(\s*)#([0-9A-Z]\d{2})([0-9A-Z]{2})\s*:\s*(.*)$/i);
    if (!row) {
      if (
        isBMS &&
        /^\s*#(?:STOP[0-9A-Z]{2}|LNOBJ|LNTYPE|LNMODE|SCROLL[0-9A-Z]{2}|BPMDEF|EXBPM|BASE)\b/i.test(
          raw,
        )
      )
        warn("STOP / ロングノート / 拡張指定のある BMS は自動変換できません。");
      converted.push(raw);
      continue;
    }
    const bar = decodeBar(row[2]),
      sourceChannel = row[3].toUpperCase(),
      data = row[4];
    maxBar = Math.max(maxBar, bar);
    let channel: string | undefined;
    if (!isBMS) channel = GDA_CHANNELS[sourceChannel];
    else if (sourceChannel === "01") {
      const n = bgmCounts.get(bar) || 0;
      bgmCounts.set(bar, n + 1);
      channel = SE_CHANNELS[n];
      if (!channel)
        warn("1 小節あたり 32 行を超える BGM があるため自動変換できません。");
    } else if (/^[0-9A-F]{2}$/.test(sourceChannel)) {
      const n = parseInt(sourceChannel, 16);
      if (n >= 0x11 && n <= 0x19)
        channel = KEYS[format as "bms" | "bme"][n - 0x11];
      else if (
        ["02", "03", "04", "05", "06", "07", "08"].includes(sourceChannel)
      )
        channel = sourceChannel;
      else {
        // Do not reinterpret BMS 2P, invisible, long-note or mine lanes as unrelated DTX controls.
        warn(`BMS チャンネル ${sourceChannel} は意味を安全に変換できません。`);
      }
    }
    if (!channel) {
      warn(
        `${format.toUpperCase()} チャンネル ${sourceChannel} は未対応です。元の行を保持しました。`,
      );
      converted.push(`; Legacy preserved: ${raw}`);
      continue;
    }
    if (channel === "02") lengthBars.add(bar);
    converted.push(`${row[1]}#${encodeBar(bar)}${channel}: ${data}`);
  }
  if (isBMS) {
    // BMS #02 applies to one measure only; DTX #02 persists until the next change.
    for (const bar of lengthBars)
      if (bar < maxBar && !lengthBars.has(bar + 1))
        converted.push(`#${encodeBar(bar + 1)}02: 1`);
  }
  const project = parseDTX(converted.join("\n"));
  project.metadata.sourceFormat = format;
  project.warnings.unshift(
    `${format.toUpperCase()} から DTX 形式へ変換しました。${isBMS ? "鍵盤レーンは DTXCreator のドラム配置に変換しています。" : ""}`,
  );
  if (project.readOnlyReason || issues.length) {
    const existing = project.readOnlyReason;
    project.readOnlyReason = `${format.toUpperCase()} の未対応・分岐・再定義構文を含むため読み取り専用です。DTX 書き出しは安全のため無効です。`;
    project.warnings.push(...issues);
    if (existing && !project.warnings.includes(existing))
      project.warnings.push(existing);
    // Keep the exact source available for recovery, but never claim raw legacy text is an exported DTX.
    project.originalText = text;
    delete project.originalFingerprint;
  } else {
    delete project.originalText;
    delete project.originalFingerprint;
  }
  return project;
}
