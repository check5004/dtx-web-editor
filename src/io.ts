import { parseDTX, type Project } from "./chart.js";
import { parseLegacyChart, type LegacyFormat } from "./legacy.js";
import { parseMIDI } from "./midi.js";
import { decodeChartBytes, type ChartEncoding } from "./encoding.js";
export type ImportFormat = "dtx" | LegacyFormat | "mid" | "midi";
export function chartFormat(filename: string): ImportFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && ["dtx", "gda", "g2d", "bms", "bme", "mid", "midi"].includes(ext))
    return ext as ImportFormat;
  throw new Error(
    "譜面形式を判定できません。DTX / GDA / G2D / BMS / BME / MID を選んでください。",
  );
}
export function parseChart(text: string, filename = "chart.dtx"): Project {
  const format = chartFormat(filename);
  if (format === "mid" || format === "midi")
    throw new Error(
      "MIDI はバイナリ形式です。parseChartBytes を使用してください。",
    );
  return format === "dtx" ? parseDTX(text) : parseLegacyChart(text, format);
}
export function parseChartBytes(
  bytes: Uint8Array,
  filename: string,
  encoding: ChartEncoding | "auto" = "auto",
): Project {
  const format = chartFormat(filename);
  return format === "mid" || format === "midi"
    ? parseMIDI(bytes)
    : parseChart(decodeChartBytes(bytes, encoding), filename);
}
