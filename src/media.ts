import {
  isWavReferenceChannel,
  beatToSeconds,
  beatToBar,
  barLengthAt,
  type Project,
  type WavResource,
} from "./chart.ts";
import { normalizePath, type ImportedFile } from "./storage.ts";
import { remapCreatorReferences } from "./creator-settings.ts";
export type MediaBank = "WAV" | "BMP" | "BMPTEX" | "AVI";
export interface MediaResource extends WavResource {
  bank?: MediaBank;
}
export const BGA_CHANNELS = ["04", "07", "55", "56", "57", "58", "59", "60"];
export const BGA_SWAP_CHANNELS = [
  "C4",
  "C7",
  "D5",
  "D6",
  "D7",
  "D8",
  "D9",
  "E0",
];
export const AVI_CHANNELS = ["54", "5A"];
const definition =
  /^\s*#(BMPTEX|BMP|AVI)([0-9A-Z]{2})(?:\s*:\s*|\s+)([^;]*)(?:;.*)?$/i;
const validId = (id: string) => {
  if (!/^[0-9A-Z]{2}$/.test(id) || id === "00")
    throw new Error("Resource ID must be 01–ZZ.");
};
function editable(p: Project): void {
  if (p.readOnlyReason) throw new Error(p.readOnlyReason);
}
export function getMediaResources(
  p: Project,
  bank: MediaBank,
): MediaResource[] {
  if (bank === "WAV")
    return Object.values(p.resources)
      .map((r) => ({ ...r, bank }))
      .sort((a, b) => a.id.localeCompare(b.id));
  return p.passthrough
    .flatMap((line) => {
      const m = line.match(definition);
      return m && m[1].toUpperCase() === bank
        ? [
            {
              bank,
              id: m[2].toUpperCase(),
              file: m[3].trim(),
              label: line.includes(";")
                ? line.slice(line.indexOf(";") + 1).trim()
                : undefined,
            },
          ]
        : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function isBankChannel(bank: MediaBank, channel: string): boolean {
  channel = channel.toUpperCase();
  return bank === "WAV"
    ? isWavReferenceChannel(channel)
    : bank === "AVI"
      ? AVI_CHANNELS.includes(channel)
      : [...BGA_CHANNELS, ...BGA_SWAP_CHANNELS].includes(channel);
}
function guardComplexReferences(p: Project, bank: MediaBank): void {
  const re =
    bank === "AVI"
      ? /^\s*#AVIPAN[0-9A-Z]{2}\b/i
      : bank === "WAV"
        ? /$a/
        : /^\s*#(?:BGA|BGAPAN)[0-9A-Z]{2}\b/i;
  if (p.passthrough.some((l) => re.test(l)))
    throw new Error(
      "This chart has BGA/BGAPAN/AVIPAN transforms. Resource deletion/reordering is disabled to preserve those references.",
    );
  if (bank === "BMP" || bank === "BMPTEX") {
    const other = new Set(
      getMediaResources(p, bank === "BMP" ? "BMPTEX" : "BMP").map((r) => r.id),
    );
    if (getMediaResources(p, bank).some((r) => other.has(r.id)))
      throw new Error(
        "BMP and BMPTEX share IDs in this chart. Reordering/deletion is disabled to preserve texture precedence.",
      );
  }
}
export function setMediaResource(
  p: Project,
  bank: MediaBank,
  resource: MediaResource,
): Project {
  editable(p);
  const id = resource.id.toUpperCase();
  validId(id);
  const file = normalizePath(resource.file);
  if (/^[a-z][a-z0-9+.-]*:/i.test(file))
    throw new Error("Only local relative file paths are allowed.");
  if (/[;\r\n]/.test(file))
    throw new Error(
      "DTX resource paths cannot contain semicolons or line breaks.",
    );
  const out = structuredClone(p);
  if (bank === "WAV") {
    out.resources[id] = { ...resource, id, file };
    delete (out.resources[id] as MediaResource).bank;
  } else {
    let found = false;
    out.passthrough = out.passthrough.map((line) => {
      const m = line.match(definition);
      if (!(m && m[1].toUpperCase() === bank && m[2].toUpperCase() === id))
        return line;
      found = true;
      const commentAt = line.indexOf(";"),
        comment = commentAt < 0 ? "" : line.slice(commentAt);
      return `#${bank}${id}: ${file}` + (comment ? "\t" + comment : "");
    });
    if (!found) {
      const label = resource.label;
      out.passthrough.push(
        `#${bank}${id}: ${file}${label ? "\t;" + String(label).replace(/[\r\n]/g, " ") : ""}`,
      );
    }
  }
  return out;
}
export function deleteMediaResource(
  p: Project,
  bank: MediaBank,
  id: string,
  removeNotes = false,
): Project {
  editable(p);
  id = id.toUpperCase();
  validId(id);
  guardComplexReferences(p, bank);
  const used = p.notes.some(
    (n) => isBankChannel(bank, n.channel) && n.value === id,
  );
  if (used && !removeNotes)
    throw new Error(
      "Resource is in use. Explicitly remove its notes before deleting.",
    );
  const out = structuredClone(p);
  if (bank === "WAV") delete out.resources[id];
  else
    out.passthrough = out.passthrough.filter((l) => {
      const m = l.match(definition);
      return !(m && m[1].toUpperCase() === bank && m[2].toUpperCase() === id);
    });
  if (removeNotes)
    out.notes = out.notes.filter(
      (n) => !(isBankChannel(bank, n.channel) && n.value === id),
    );
  return out;
}
/** Reassign existing sorted ID slots to the supplied order and remap only that bank's references. */
export function reorderMediaResources(
  p: Project,
  bank: MediaBank,
  orderedIds: string[],
): Project {
  editable(p);
  guardComplexReferences(p, bank);
  const resources = getMediaResources(p, bank),
    ids = resources.map((r) => r.id),
    order = orderedIds.map((id) => id.toUpperCase());
  if (
    order.length !== ids.length ||
    new Set(order).size !== ids.length ||
    order.some((id) => !ids.includes(id))
  )
    throw new Error("Order must contain every resource ID exactly once.");
  const map = new Map(order.map((id, i) => [id, ids[i]]));
  let out = structuredClone(p);
  if (bank === "WAV")
    out.resources = Object.fromEntries(
      Object.values(p.resources).map((r) => {
        const id = map.get(r.id) || r.id;
        return [id, { ...r, id }];
      }),
    );
  else
    out.passthrough = out.passthrough.map((line) => {
      const m = line.match(definition);
      return m && m[1].toUpperCase() === bank
        ? line.replace(
            new RegExp(`(#${bank})${m[2]}`, "i"),
            `$1${map.get(m[2].toUpperCase())}`,
          )
        : line;
    });
  out.notes = out.notes.map((n) =>
    isBankChannel(bank, n.channel) && map.has(n.value)
      ? { ...n, value: map.get(n.value)! }
      : n,
  );
  return remapCreatorReferences(out, bank, Object.fromEntries(map));
}
/** Exact chart-directory-relative resolution; never silently pick among equal basenames. */
export function resolveMediaFile(
  files: ImportedFile[],
  path: string,
  chartPath = "",
): ImportedFile | undefined {
  let normalized: string;
  try {
    normalized = normalizePath(path).toLowerCase();
  } catch {
    return undefined;
  }
  const dir = chartPath
    .replace(/\\/g, "/")
    .split("/")
    .slice(0, -1)
    .join("/")
    .toLowerCase();
  const target = dir ? `${dir}/${normalized}` : normalized;
  const exact = files.filter((f) => f.path.toLowerCase() === target);
  if (exact.length === 1) return exact[0];
  return undefined;
}

export type MediaTransformKind = "BGA" | "BGAPAN" | "AVIPAN";
export interface MediaFrame {
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
  destX: number;
  destY: number;
}
export interface MediaTransform {
  kind: MediaTransformKind;
  id: string;
  resourceId: string;
  start: MediaFrame;
  end: MediaFrame;
  durationTicks: number;
}
const transformHeader =
  /^\s*#(BGAPAN|AVIPAN|BGA)([0-9A-Z]{2})(?:\s*:\s*|\s+)([^;]*)/i;
export function parseMediaTransform(line: string): MediaTransform | undefined {
  const m = line.match(transformHeader);
  if (!m) return undefined;
  const kind = m[1].toUpperCase() as MediaTransformKind,
    args = m[3]
      .trim()
      .split(/[\s,()[\]x|]+/)
      .filter(Boolean),
    count = kind === "BGA" ? 7 : 14;
  if (args.length !== count || !/^[0-9A-Z]{1,2}$/i.test(args[0]))
    throw new Error(`Invalid #${kind}${m[2]} parameters (${count} required).`);
  const resourceId = args[0].toUpperCase().padStart(2, "0");
  validId(resourceId);
  const n = args.slice(1).map(Number);
  if (n.some((v) => !Number.isInteger(v) || Math.abs(v) > 1000000))
    throw new Error(
      "Media transform coordinates/ticks must be bounded integers.",
    );
  let start: MediaFrame,
    end: MediaFrame,
    durationTicks = 0;
  if (kind === "BGA") {
    start = {
      sourceX: Math.min(n[0], n[2]),
      sourceY: Math.min(n[1], n[3]),
      width: Math.abs(n[2] - n[0]),
      height: Math.abs(n[3] - n[1]),
      destX: n[4],
      destY: n[5],
    };
    end = { ...start };
  } else {
    start = {
      width: n[0],
      height: n[1],
      sourceX: n[4],
      sourceY: n[5],
      destX: n[8],
      destY: n[9],
    };
    end = {
      width: n[2],
      height: n[3],
      sourceX: n[6],
      sourceY: n[7],
      destX: n[10],
      destY: n[11],
    };
    durationTicks = Math.max(0, n[12]);
  }
  return {
    kind,
    id: m[2].toUpperCase(),
    resourceId,
    start,
    end,
    durationTicks,
  };
}
export function getMediaTransforms(p: Project): MediaTransform[] {
  const map = new Map<string, MediaTransform>();
  for (const line of p.passthrough) {
    const transform = parseMediaTransform(line);
    if (transform) map.set(transform.kind + transform.id, transform);
  }
  return [...map.values()];
}
export function setMediaTransform(p: Project, t: MediaTransform): Project {
  editable(p);
  validId(t.id);
  validId(t.resourceId);
  if (!["BGA", "BGAPAN", "AVIPAN"].includes(t.kind))
    throw new Error("Unknown transform kind.");
  const a = t.start,
    b = t.end,
    params =
      t.kind === "BGA"
        ? [
            a.sourceX,
            a.sourceY,
            a.sourceX + a.width,
            a.sourceY + a.height,
            a.destX,
            a.destY,
          ]
        : [
            a.width,
            a.height,
            b.width,
            b.height,
            a.sourceX,
            a.sourceY,
            b.sourceX,
            b.sourceY,
            a.destX,
            a.destY,
            b.destX,
            b.destY,
            t.durationTicks,
          ];
  if (
    params.some((v) => !Number.isInteger(v) || Math.abs(v) > 1000000) ||
    a.width < 0 ||
    a.height < 0 ||
    b.width < 0 ||
    b.height < 0 ||
    t.durationTicks < 0
  )
    throw new Error(
      "Transform values must be bounded integers with nonnegative sizes/duration.",
    );
  const line = `#${t.kind}${t.id}: ${t.resourceId} ${params.join(" ")}`;
  parseMediaTransform(line);
  const out = structuredClone(p);
  out.passthrough = out.passthrough.filter((l) => {
    const m = l.match(transformHeader);
    return !(m && m[1].toUpperCase() === t.kind && m[2].toUpperCase() === t.id);
  });
  out.passthrough.push(line);
  return out;
}
export function deleteMediaTransform(
  p: Project,
  kind: MediaTransformKind,
  id: string,
): Project {
  editable(p);
  const out = structuredClone(p);
  out.passthrough = out.passthrough.filter((l) => {
    const m = l.match(transformHeader);
    return !(m && m[1].toUpperCase() === kind && m[2].toUpperCase() === id);
  });
  return out;
}
/** NX stores 384 counts per measure; duration uses the BPM/bar length at the chip. */
export function mediaTransformDuration(
  p: Project,
  beat: number,
  t: MediaTransform,
): number {
  const bar = beatToBar(p, beat).bar;
  let bpm = p.metadata.bpm;
  for (const tempo of p.tempos.slice().sort((a, b) => a.beat - b.beat)) {
    if (tempo.beat > beat) break;
    bpm = tempo.bpm;
  }
  return Math.round((625 * t.durationTicks * barLengthAt(p, bar)) / bpm) / 1000;
}
export function interpolateMediaFrame(
  t: MediaTransform,
  progress: number,
): MediaFrame {
  const ratio = t.kind === "BGA" ? 0 : Math.max(0, Math.min(1, progress));
  const result = {} as MediaFrame;
  for (const key of [
    "sourceX",
    "sourceY",
    "width",
    "height",
    "destX",
    "destY",
  ] as const)
    result[key] =
      t.start[key] + Math.trunc((t.end[key] - t.start[key]) * ratio);
  return result;
}
export function clipMediaFrame(
  frame: MediaFrame,
  imageWidth: number,
  imageHeight: number,
  viewportWidth = 278,
  viewportHeight = 355,
): MediaFrame | undefined {
  const f = { ...frame };
  const left = Math.max(0, -f.sourceX, -f.destX),
    top = Math.max(0, -f.sourceY, -f.destY);
  f.sourceX += left;
  f.destX += left;
  f.width -= left;
  f.sourceY += top;
  f.destY += top;
  f.height -= top;
  f.width = Math.min(f.width, imageWidth - f.sourceX, viewportWidth - f.destX);
  f.height = Math.min(
    f.height,
    imageHeight - f.sourceY,
    viewportHeight - f.destY,
  );
  return f.width > 0 && f.height > 0 ? f : undefined;
}
export function applyBmpBlackKey(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0)
      pixels[i + 3] = 0;
}
export interface ActiveMediaLayer {
  layer: string;
  resourceId: string;
  originalResourceId: string;
  video: boolean;
  startTime: number;
  startBeat: number;
  transform?: MediaTransform;
}
/** Replay from the beginning on every seek, including backwards, preserving swap scope. */
export function activeMediaLayers(
  p: Project,
  time: number,
  transforms = getMediaTransforms(p),
): ActiveMediaLayer[] {
  const active = new Map<string, ActiveMediaLayer>();
  for (const n of p.notes.slice().sort((a, b) => a.beat - b.beat)) {
    const at = beatToSeconds(p, n.beat);
    if (at > time) break;
    const swap = BGA_SWAP_CHANNELS.indexOf(n.channel);
    if (swap >= 0) {
      const layer = BGA_CHANNELS[swap],
        old = active.get(layer);
      if (old) active.set(layer, { ...old, resourceId: n.value });
      continue;
    }
    const video = AVI_CHANNELS.includes(n.channel);
    if (!video && !BGA_CHANNELS.includes(n.channel)) continue;
    let transform = video
      ? transforms.find((t) => t.kind === "AVIPAN" && t.id === n.value)
      : transforms.find((t) => t.kind === "BGAPAN" && t.id === n.value) ||
        transforms.find((t) => t.kind === "BGA" && t.id === n.value);
    const exists = (id: string) =>
      video
        ? getMediaResources(p, "AVI").some((r) => r.id === id)
        : [
            ...getMediaResources(p, "BMP"),
            ...getMediaResources(p, "BMPTEX"),
          ].some((r) => r.id === id);
    if (transform && !exists(transform.resourceId)) {
      transform = video
        ? undefined
        : transforms.find(
            (t) => t.kind === "BGA" && t.id === n.value && exists(t.resourceId),
          );
    }
    const layer = video ? "video" : n.channel;
    active.set(layer, {
      layer,
      resourceId: transform?.resourceId || n.value,
      originalResourceId: transform?.resourceId || n.value,
      video,
      startTime: at,
      startBeat: n.beat,
      transform,
    });
  }
  return [...active.values()].sort(
    (a, b) =>
      (a.video ? 9 : BGA_CHANNELS.indexOf(a.layer)) -
      (b.video ? 9 : BGA_CHANNELS.indexOf(b.layer)),
  );
}
export class LocalMediaPreview {
  private project?: Project;
  private files: ImportedFile[] = [];
  private chartPath = "";
  private transforms: MediaTransform[] = [];
  private canvas: HTMLCanvasElement;
  private scratch?: HTMLCanvasElement;
  private media = new Map<
    string,
    { element: HTMLImageElement | HTMLVideoElement; url: string }
  >();
  private reported = new Set<string>();
  private last = { time: 0, playing: false, rate: 1 };
  constructor(
    private container: HTMLElement,
    private onError: (message: string) => void = () => {},
  ) {
    container.style.position = "relative";
    container.style.overflow = "hidden";
    container.style.background = "#000";
    container.style.minHeight = "180px";
    this.canvas = document.createElement("canvas");
    this.canvas.width = 278;
    this.canvas.height = 355;
    this.canvas.style.cssText =
      "display:block;width:100%;height:100%;object-fit:contain;";
    container.append(this.canvas);
  }
  setProject(project: Project, files: ImportedFile[], chartPath = ""): void {
    this.clear();
    this.reported.clear();
    this.project = {
      ...project,
      notes: project.notes.filter(
        (n) =>
          BGA_CHANNELS.includes(n.channel) ||
          BGA_SWAP_CHANNELS.includes(n.channel) ||
          AVI_CHANNELS.includes(n.channel),
      ),
    };
    this.files = files;
    this.chartPath = chartPath;
    this.transforms = [];
    for (const line of project.passthrough) {
      try {
        const t = parseMediaTransform(line);
        if (t) {
          this.transforms = this.transforms.filter(
            (old) => old.kind !== t.kind || old.id !== t.id,
          );
          this.transforms.push(t);
          if (t.kind === "AVIPAN")
            this.error(
              "AVIPAN preview applies its declared crop/motion; the current NX video renderer uses its own full-video layout.",
            );
        }
      } catch (error) {
        this.error(String(error));
      }
    }
  }
  private error(message: string): void {
    if (!this.reported.has(message)) {
      this.reported.add(message);
      this.onError(message);
    }
  }
  update(time: number, playing = false, rate = 1): void {
    this.last = { time, playing, rate };
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.project) return;
    const active = activeMediaLayers(this.project, time, this.transforms),
      used = new Set<string>();
    for (const layer of active) {
      const resource = layer.video
        ? getMediaResources(this.project, "AVI").find(
            (r) => r.id === layer.resourceId,
          )
        : getMediaResources(this.project, "BMPTEX").find(
            (r) => r.id === layer.resourceId,
          ) ||
          getMediaResources(this.project, "BMP").find(
            (r) => r.id === layer.resourceId,
          );
      const file =
        resource && resolveMediaFile(this.files, resource.file, this.chartPath);
      if (!file) {
        this.error(
          `Missing local ${layer.video ? "video" : "image"} resource ${layer.resourceId}.`,
        );
        continue;
      }
      const key = `${layer.layer}:${layer.resourceId}:${layer.startTime}`;
      used.add(key);
      let item = this.media.get(key);
      if (!item) {
        const url = URL.createObjectURL(file.blob),
          element = document.createElement(layer.video ? "video" : "img");
        element.onerror = () =>
          this.error(
            `Cannot decode ${resource!.file} in this browser. Container support does not guarantee codec support.`,
          );
        if (element instanceof HTMLVideoElement) {
          element.muted = true;
          element.playsInline = true;
          element.preload = "auto";
          element.onloadeddata = () =>
            this.update(this.last.time, this.last.playing, this.last.rate);
          element.onseeked = () =>
            this.update(this.last.time, this.last.playing, this.last.rate);
        } else
          element.onload = () =>
            this.update(this.last.time, this.last.playing, this.last.rate);
        element.src = url;
        item = { element, url };
        this.media.set(key, item);
      }
      const el = item.element;
      let width: number, height: number;
      if (el instanceof HTMLVideoElement) {
        const position = Math.max(0, time - layer.startTime);
        el.playbackRate = Math.max(0.25, Math.min(2, rate));
        if (el.readyState >= 1 && Math.abs(el.currentTime - position) > 0.12) {
          try {
            el.currentTime = Math.min(
              position,
              Number.isFinite(el.duration) ? el.duration : position,
            );
          } catch {
            /* metadata pending */
          }
        }
        if (playing && el.paused && !el.ended)
          void el
            .play()
            .catch(() =>
              this.error(
                "Local video playback was blocked; press play after a user gesture.",
              ),
            );
        if (!playing && !el.paused) el.pause();
        width = el.videoWidth;
        height = el.videoHeight;
        if (el.readyState < 2) continue;
      } else {
        width = el.naturalWidth;
        height = el.naturalHeight;
        if (!el.complete || !width) continue;
      }
      let scopeWidth = width,
        scopeHeight = height;
      if (
        !layer.video &&
        !layer.transform &&
        layer.originalResourceId !== layer.resourceId
      ) {
        const original =
            getMediaResources(this.project, "BMPTEX").find(
              (r) => r.id === layer.originalResourceId,
            ) ||
            getMediaResources(this.project, "BMP").find(
              (r) => r.id === layer.originalResourceId,
            ),
          originalFile =
            original &&
            resolveMediaFile(this.files, original.file, this.chartPath),
          scopeKey = `scope:${layer.layer}:${layer.originalResourceId}:${layer.startTime}`;
        if (originalFile) {
          used.add(scopeKey);
          let origin = this.media.get(scopeKey);
          if (!origin) {
            const element = document.createElement("img"),
              url = URL.createObjectURL(originalFile.blob);
            element.onload = () =>
              this.update(this.last.time, this.last.playing, this.last.rate);
            element.onerror = () =>
              this.error(
                `Cannot decode original scope image ${original!.file}.`,
              );
            element.src = url;
            origin = { element, url };
            this.media.set(scopeKey, origin);
          }
          const image = origin.element as HTMLImageElement;
          if (!image.complete || !image.naturalWidth) continue;
          scopeWidth = image.naturalWidth;
          scopeHeight = image.naturalHeight;
        }
      }
      const duration = layer.transform
        ? mediaTransformDuration(this.project, layer.startBeat, layer.transform)
        : 0;
      const frame = layer.transform
        ? interpolateMediaFrame(
            layer.transform,
            duration ? (time - layer.startTime) / duration : 0,
          )
        : {
            sourceX: 0,
            sourceY: 0,
            width: scopeWidth,
            height: scopeHeight,
            destX: 0,
            destY: 0,
          };
      const clipped = clipMediaFrame(frame, width, height);
      if (!clipped) continue;
      try {
        const draw = (target: CanvasRenderingContext2D) =>
          target.drawImage(
            el,
            clipped.sourceX,
            clipped.sourceY,
            clipped.width,
            clipped.height,
            clipped.destX,
            clipped.destY,
            clipped.width,
            clipped.height,
          );
        if (resource?.bank === "BMP") {
          if (!this.scratch) {
            this.scratch = document.createElement("canvas");
            this.scratch.width = 278;
            this.scratch.height = 355;
          }
          const target = this.scratch.getContext("2d")!;
          target.clearRect(0, 0, 278, 355);
          draw(target);
          const pixels = target.getImageData(0, 0, 278, 355);
          applyBmpBlackKey(pixels.data);
          target.putImageData(pixels, 0, 0);
          ctx.drawImage(this.scratch, 0, 0);
        } else draw(ctx);
      } catch {
        this.error(`Cannot render local resource ${resource!.file}.`);
      }
    }
    for (const [key, item] of this.media)
      if (!used.has(key)) {
        if (item.element instanceof HTMLVideoElement) item.element.pause();
        URL.revokeObjectURL(item.url);
        this.media.delete(key);
      }
  }
  private clear(): void {
    for (const item of this.media.values()) {
      if (item.element instanceof HTMLVideoElement) item.element.pause();
      URL.revokeObjectURL(item.url);
    }
    this.media.clear();
    this.canvas
      .getContext("2d")
      ?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  dispose(): void {
    this.clear();
    this.canvas.remove();
    this.project = undefined;
  }
}
