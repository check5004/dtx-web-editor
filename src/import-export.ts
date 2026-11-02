/** Untrusted import boundary. Limits are browser safety bounds, not DTX format limits. */
import { unzipSync, type UnzipFileInfo } from "fflate";
import { LANES, parseDTX, type Project } from "./chart";
import { parseLegacyChart, type LegacyFormat } from "./legacy";
import { normalizePath, hashBlob, type ImportedFile } from "./storage";
export const PROJECT_IMPORT_LIMITS = Object.freeze({
  notes: 50000,
  tempos: 8192,
  bars: 3600,
  beats: 230400,
  textBytes: 8 * 1024 * 1024,
  passthroughLines: 50000,
});
export interface ProjectManifest {
  version: 1;
  project: Project;
  referencePath: string;
  youtubeId: string;
  referenceOffset: number;
  referenceBgmId: string;
  chartPath: string;
}
const fail = (message: string): never => {
  throw new Error(`Unsafe project: ${message}`);
};
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(`${label} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    return fail(`${label} has an unsupported prototype`);
  for (const key of Object.keys(value))
    if (["__proto__", "constructor", "prototype"].includes(key))
      return fail(`${label} contains an unsafe key`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 16384): string {
  if (typeof value !== "string" || value.length > max)
    return fail(`${label} must be a string of at most ${max} characters`);
  return value;
}
function number(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    return fail(
      `${label} must be ${integer ? "an integer" : "finite"} in ${min}…${max}`,
    );
  return value;
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    return fail(`${label} must be an array of at most ${max} items`);
  return value;
}
function id(value: unknown, label: string, zero = false): string {
  const s = string(value, label, 2);
  if (!/^[0-9A-Z]{2}$/.test(s) || (!zero && s === "00"))
    return fail(`${label} must be ${zero ? "00" : "01"}–ZZ`);
  return s;
}
export function safeAssetPath(value: string): string {
  if (
    value.length > 1024 ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    /[;\r\n]/.test(value)
  )
    throw new Error("Asset paths must be safe local relative paths.");
  return normalizePath(value);
}
export function validateProjectManifest(
  value: unknown,
  options: { chartPath?: string } = {},
): ProjectManifest {
  const manifest = object(value, "manifest");
  if (manifest.version !== 1) fail("unsupported manifest version");
  const p = object(manifest.project, "project"),
    m = object(p.metadata, "metadata");
  const storedChartPath =
    manifest.chartPath === undefined
      ? ""
      : string(manifest.chartPath, "chartPath", 1024);
  if (storedChartPath) safeAssetPath(storedChartPath);
  const selectedChartPath =
    options.chartPath === undefined
      ? storedChartPath
      : string(options.chartPath, "chartPath override", 1024);
  const chartPath = selectedChartPath ? safeAssetPath(selectedChartPath) : "";
  for (const [key, value] of Object.entries(m))
    if (
      typeof value !== "string" &&
      !(typeof value === "number" && Number.isFinite(value))
    )
      fail(`metadata ${key} must be a finite number or string`);
  const metadata: Project["metadata"] = {
    title: string(m.title, "title"),
    artist: string(m.artist, "artist"),
    comment: string(m.comment, "comment", 65536),
    bpm: number(m.bpm, "BPM", 0.1, 10000),
    baseBpm: number(m.baseBpm, "BASEBPM", 0, 10000),
    preview: string(m.preview, "preview", 1024),
    background: string(m.background, "background", 1024),
  };
  if (m.sourceFormat !== undefined) {
    const format = string(m.sourceFormat, "sourceFormat", 8);
    if (!["dtx", "gda", "g2d", "bms", "bme", "mid", "midi"].includes(format))
      fail("invalid source format");
    metadata.sourceFormat = format;
  }
  const resources: Project["resources"] = {};
  const rawResources = object(p.resources, "resources");
  if (Object.keys(rawResources).length > 1295) fail("too many resources");
  for (const [key, value] of Object.entries(rawResources)) {
    id(key, "resource key");
    const r = object(value, "resource");
    if (id(r.id, "resource ID") !== key) fail("resource key / ID mismatch");
    const file = string(r.file, "resource file", 1024);
    if (file) {
      if (chartPath) resolveImportedAssetPath(file, chartPath);
      else safeAssetPath(file);
    }
    const entry: Project["resources"][string] = { id: key, file };
    if (r.label !== undefined)
      entry.label = string(r.label, "resource label", 1024);
    if (r.volume !== undefined)
      entry.volume = number(r.volume, "volume", 0, 100);
    if (r.pan !== undefined) entry.pan = number(r.pan, "pan", -100, 100);
    if (r.size !== undefined) entry.size = number(r.size, "size", 0, 1000);
    resources[key] = entry;
  }
  const noteIds = new Set<string>();
  const notes: Project["notes"] = array(
    p.notes,
    "notes",
    PROJECT_IMPORT_LIMITS.notes,
  ).map((value) => {
    const n = object(value, "note"),
      noteId = string(n.id, "note ID", 256);
    if (!noteId || noteIds.has(noteId))
      fail("note IDs must be nonempty and unique");
    noteIds.add(noteId);
    const channel = string(n.channel, "channel", 2);
    if (!/^[0-9A-F]{2}$/.test(channel)) fail("invalid channel");
    if (["00", "02", "03", "08"].includes(channel)) fail("structural channels cannot appear in notes; use barLengths or tempos");
    const note: Project["notes"][number] = {
      id: noteId,
      beat: number(n.beat, "note beat", 0, PROJECT_IMPORT_LIMITS.beats),
      channel,
      value: id(n.value, "note value"),
    };
    if (n.lane !== undefined) {
      if (!LANES.some((l) => l.id === n.lane)) fail("unknown lane");
      note.lane = n.lane as typeof note.lane;
    }
    return note;
  });
  const tempoIds = new Set<string>();
  const tempos: Project["tempos"] = array(
    p.tempos,
    "tempos",
    PROJECT_IMPORT_LIMITS.tempos,
  ).map((value) => {
    const t = object(value, "tempo"),
      tempoId = string(t.id, "tempo ID", 256);
    if (!tempoId || tempoIds.has(tempoId)) fail("tempo IDs must be unique");
    tempoIds.add(tempoId);
    if (t.channel !== "03" && t.channel !== "08") fail("invalid tempo channel");
    return {
      id: tempoId,
      beat: number(t.beat, "tempo beat", 0, PROJECT_IMPORT_LIMITS.beats),
      bpm: number(t.bpm, "tempo BPM", 0.1, 20000),
      channel: t.channel as "03" | "08",
      value: id(t.value, "tempo value"),
    };
  });
  const barCount = number(
      p.barCount,
      "bar count",
      1,
      PROJECT_IMPORT_LIMITS.bars,
      true,
    ),
    barLengths: Record<number, number> = {};
  const rawBars = object(p.barLengths, "bar lengths");
  if (Object.keys(rawBars).length > PROJECT_IMPORT_LIMITS.bars)
    fail("too many bar changes");
  for (const [key, value] of Object.entries(rawBars)) {
    if (!/^(?:0|[1-9]\d*)$/.test(key)) fail("invalid bar number");
    const bar = number(
      Number(key),
      "bar number",
      0,
      PROJECT_IMPORT_LIMITS.bars - 1,
      true,
    );
    barLengths[bar] = number(value, "bar length", 1 / 64, 16);
  }
  let duration = 0,
    length = 1;
  for (let bar = 0; bar < barCount; bar++) {
    length = barLengths[bar] ?? length;
    duration += 4 * length;
    if (duration > PROJECT_IMPORT_LIMITS.beats)
      fail("chart duration exceeds browser safety limit");
  }
  for (const note of [...notes, ...tempos])
    if (note.beat >= PROJECT_IMPORT_LIMITS.beats)
      fail("event extends beyond browser safety limit");
  const bpmDefinitions: Record<string, number> = {};
  const rawBpm = object(p.bpmDefinitions, "BPM definitions");
  if (Object.keys(rawBpm).length > 1296) fail("too many BPM definitions");
  for (const [key, value] of Object.entries(rawBpm)) {
    id(key, "BPM ID", true);
    bpmDefinitions[key] = number(value, "BPM definition", 0.1, 10000);
  }
  let textLength = 0;
  const strings = (value: unknown, label: string, max: number) =>
    array(value, label, max).map((v) => {
      const s = string(v, label, PROJECT_IMPORT_LIMITS.textBytes);
      textLength += s.length;
      if (textLength > PROJECT_IMPORT_LIMITS.textBytes)
        fail("text payload exceeds limit");
      return s;
    });
  const project: Project = {
    metadata,
    resources,
    notes,
    tempos,
    barLengths,
    barCount,
    bpmDefinitions,
    passthrough: strings(
      p.passthrough,
      "passthrough",
      PROJECT_IMPORT_LIMITS.passthroughLines,
    ),
    warnings: strings(p.warnings, "warnings", 5000),
  };
  for (const key of [
    "originalText",
    "originalFingerprint",
    "readOnlyReason",
  ] as const)
    if (p[key] !== undefined)
      project[key] = string(p[key], key, PROJECT_IMPORT_LIMITS.textBytes);
  const referencePath =
    manifest.referencePath === undefined
      ? ""
      : string(manifest.referencePath, "referencePath", 1024);
  if (referencePath) safeAssetPath(referencePath);
  const youtubeId =
    manifest.youtubeId === undefined
      ? ""
      : string(manifest.youtubeId, "youtubeId", 11);
  if (youtubeId && !/^[A-Za-z0-9_-]{11}$/.test(youtubeId))
    fail("invalid YouTube video ID");
  const referenceOffset =
    manifest.referenceOffset === undefined
      ? 0
      : number(manifest.referenceOffset, "referenceOffset", -86400, 86400);
  const referenceBgmId =
    manifest.referenceBgmId === undefined || manifest.referenceBgmId === ""
      ? ""
      : id(manifest.referenceBgmId, "referenceBgmId");
  if (project.readOnlyReason && !project.originalText)
    fail("protected charts require original DTX text");
  if (project.originalText) {
    // Reconstruct protection and fingerprint from the actual parser; never trust a manifest's guard fields.
    if (project.originalText.length > 2 * 1024 * 1024)
      fail("original DTX text exceeds safe parse limit");
    const chipCharacters = project.originalText
      .split(/\r?\n/)
      .reduce(
        (sum, line) =>
          sum +
          (/^\s*#[0-9A-Z]\d{2}[0-9A-Z]{2}\s*:/i.test(line) ? line.length : 0),
        0,
      );
    if (chipCharacters > 250000)
      fail("original DTX contains too much chip data");
    const parsed = ["gda", "g2d", "bms", "bme"].includes(
      String(metadata.sourceFormat),
    )
      ? parseLegacyChart(
          project.originalText,
          metadata.sourceFormat as LegacyFormat,
        )
      : parseDTX(project.originalText);
    if (parsed.readOnlyReason) {
      const checked = validateProjectManifest(
        {
          version: 1,
          project: {
            ...parsed,
            originalText: undefined,
            originalFingerprint: undefined,
            readOnlyReason: undefined,
          },
          referencePath,
          youtubeId,
          referenceOffset,
          referenceBgmId,
          chartPath,
        },
        { chartPath },
      );
      checked.project.originalText = parsed.originalText;
      checked.project.originalFingerprint = parsed.originalFingerprint;
      checked.project.readOnlyReason = parsed.readOnlyReason;
      return checked;
    }
    if (project.readOnlyReason)
      fail("manifest protection is not supported by its original DTX");
    project.originalFingerprint = parsed.originalFingerprint;
  } else delete project.originalFingerprint;
  // Explicit projection deliberately drops API credentials, editor settings, and unknown top-level fields.
  return {
    version: 1,
    project,
    referencePath,
    youtubeId,
    referenceOffset,
    referenceBgmId,
    chartPath,
  };
}
export interface ArchiveLimits {
  maxCompressedBytes: number;
  maxOriginalBytes: number;
  maxFileBytes: number;
  maxEntries: number;
}
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxCompressedBytes: 150 * 1024 * 1024,
  maxOriginalBytes: 500 * 1024 * 1024,
  maxFileBytes: 150 * 1024 * 1024,
  maxEntries: 10000,
};
export function createSafeArchiveFilter(
  overrides: Partial<ArchiveLimits> = {},
): (entry: UnzipFileInfo) => boolean {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
  let total = 0,
    count = 0;
  const paths = new Set<string>();
  return (entry) => {
    if (++count > limits.maxEntries)
      throw new Error("Archive entry count exceeds limit.");
    if (
      !Number.isSafeInteger(entry.originalSize) ||
      entry.originalSize < 0 ||
      entry.originalSize > limits.maxFileBytes
    )
      throw new Error("Archive file size exceeds limit.");
    if (!Number.isSafeInteger(entry.size) || entry.size < 0)
      throw new Error("Invalid compressed file size.");
    total += entry.originalSize;
    if (total > limits.maxOriginalBytes)
      throw new Error("Archive expanded size exceeds limit.");
    const isDirectory = /[\\/]$/.test(entry.name);
    const path = safeAssetPath(
        isDirectory ? entry.name.slice(0, -1) : entry.name,
      ),
      key = path.toLowerCase();
    if (paths.has(key))
      throw new Error(`Duplicate case-normalized archive path: ${path}`);
    paths.add(key);
    return !isDirectory;
  };
}
export function safeUnzip(
  bytes: Uint8Array,
  limits: Partial<ArchiveLimits> = {},
): Record<string, Uint8Array> {
  const bounds = { ...DEFAULT_ARCHIVE_LIMITS, ...limits };
  if (bytes.byteLength > bounds.maxCompressedBytes)
    throw new Error("Compressed archive exceeds limit.");
  const extracted = unzipSync(bytes, {
      filter: createSafeArchiveFilter(bounds),
    }),
    out: Record<string, Uint8Array> = Object.create(null);
  let total = 0;
  for (const [name, data] of Object.entries(extracted)) {
    total += data.byteLength;
    if (
      data.byteLength > bounds.maxFileBytes ||
      total > bounds.maxOriginalBytes
    )
      throw new Error("Actual archive size exceeds limit.");
    out[safeAssetPath(name)] = data;
  }
  return out;
}
export function resolveChartAsset(
  files: ImportedFile[],
  resourcePath: string,
  chartPath = "",
): ImportedFile | undefined {
  let path: string;
  try {
    path = resolveImportedAssetPath(resourcePath, chartPath).toLowerCase();
  } catch {
    return undefined;
  }
  const matches = files.filter(
    (f) => f.path.normalize("NFC").toLowerCase() === path,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
export interface LibraryAsset {
  hash: string;
  blob: Blob;
  paths: string[];
  size: number;
  type: string;
}
/** Hash actual bytes, not caller-supplied hashes. Keep every alias so chart references remain valid. */
export async function deduplicateAssetLibrary(
  input: ImportedFile[],
): Promise<{ files: ImportedFile[]; assets: LibraryAsset[] }> {
  const byHash = new Map<string, LibraryAsset>(),
    seenPaths = new Map<string, string>(),
    files: ImportedFile[] = [];
  for (const f of input) {
    const path = safeAssetPath(f.path),
      hash = await hashBlob(f.blob),
      key = path.toLowerCase();
    if (seenPaths.has(key)) {
      if (seenPaths.get(key) !== hash)
        throw new Error(`Conflicting bytes at asset path: ${path}`);
      continue;
    }
    seenPaths.set(key, hash);
    let asset = byHash.get(hash);
    if (!asset) {
      asset = {
        hash,
        blob: f.blob,
        paths: [],
        size: f.blob.size,
        type: f.type,
      };
      byHash.set(hash, asset);
    }
    asset.paths.push(path);
    files.push({
      ...f,
      path,
      name: path.split("/").at(-1)!,
      hash,
      blob: asset.blob,
      size: asset.size,
    });
  }
  return { files, assets: [...byHash.values()] };
}
/** Resolve a chart-relative filename inside the user-selected import pack; never outside it. */
export function resolveImportedAssetPath(
  resourcePath: string,
  chartPath = "",
): string {
  if (
    typeof resourcePath !== "string" ||
    resourcePath.length > 1024 ||
    /^[a-z][a-z0-9+.-]*:/i.test(resourcePath) ||
    /[;\x00-\x1f]/.test(resourcePath)
  )
    throw new Error("Asset path must be a local relative filename.");
  const path = resourcePath.replace(/\\/g, "/");
  if (path.startsWith("/"))
    throw new Error("Absolute asset paths are not allowed.");
  const base = chartPath
    ? safeAssetPath(chartPath).split("/").slice(0, -1)
    : [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!base.length)
        throw new Error("Asset path escapes the selected import folder.");
      base.pop();
    } else base.push(segment);
  }
  if (!base.length) throw new Error("Asset path does not identify a file.");
  return safeAssetPath(base.join("/"));
}
/**
 * Editable charts become root-relative and can be exported as a root-level DTX.
 * Protected charts remain byte/fingerprint-identical: retain their original chartPath and entire pack.
 */
export function rebaseImportedChart(
  project: Project,
  chartPath: string,
): Project {
  safeAssetPath(chartPath);
  const out = structuredClone(project),
    protect = !!project.readOnlyReason;
  const rebase = (path: string) =>
    path ? resolveImportedAssetPath(path, chartPath) : path;
  for (const resource of Object.values(out.resources)) {
    const path = rebase(resource.file);
    if (!protect) resource.file = path;
  }
  for (const key of ["preview", "background"] as const) {
    const path = rebase(String(out.metadata[key] || ""));
    if (!protect) out.metadata[key] = path;
  }
  // Only filename-bearing directives, never BGA/BGAPAN/AVIPAN numeric transform definitions.
  const filename =
    /^(\s*#(?:BMPTEX[0-9A-Z]{2}|BMP[0-9A-Z]{2}|AVI[0-9A-Z]{2}|PREIMAGE|PREMOVIE|STAGEFILE|BANNER|BACKBMP|RESULTIMAGE|RESULTMOVIE|RESULTSOUND)(?:\s*:\s*|\s+))([^;]*)(;.*)?$/i;
  out.passthrough = out.passthrough.map((line) => {
    const m = line.match(filename);
    if (!m) return line;
    const path = rebase(m[2].trim());
    return protect ? line : `${m[1]}${path}${m[3] || ""}`;
  });
  return out;
}
