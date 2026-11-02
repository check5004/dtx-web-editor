import Encoding from "encoding-japanese";
export type ChartEncoding = "utf8" | "cp932";
/** UTF-8 (including BOM) first; legacy DTX falls back to Windows-31J / CP932. */
export function decodeChartBytes(
  bytes: Uint8Array,
  encoding: ChartEncoding | "auto" = "auto",
): string {
  if (encoding === "utf8")
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (encoding === "cp932")
    return new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff))
  )
    return new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be", {
      fatal: true,
    }).decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
  }
}
/** Reject unmappable characters instead of silently replacing them with '?'. */
export function encodeChartText(
  text: string,
  encoding: ChartEncoding = "cp932",
): Uint8Array<ArrayBuffer> {
  if (encoding === "utf8") return new TextEncoder().encode(text);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(
      Encoding.convert(Encoding.stringToCode(text), {
        to: "SJIS",
        from: "UNICODE",
        type: "array",
        fallback: "error",
      }),
    );
  } catch {
    throw new Error(
      "CP932 で表せない文字があります。UTF-8 を選ぶか、絵文字などの文字を変更してください。",
    );
  }
  // CP932 has a few historically ambiguous glyphs. Fail closed if decoded bytes change the input.
  if (decodeChartBytes(bytes, "cp932") !== text)
    throw new Error(
      "CP932 への変換で文字が変化します。文字化けを防ぐため UTF-8 で保存してください。",
    );
  return bytes;
}
export const encodeCP932 = (text: string): Uint8Array<ArrayBuffer> =>
  encodeChartText(text, "cp932");
