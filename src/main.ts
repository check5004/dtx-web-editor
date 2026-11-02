import "./style.css";
import { getHoldSpans, setHold, removeHold } from "./holds";
import { assertNoNewNoteCollisions } from "./collisions";
import { unzipSync, zipSync, strToU8 } from "fflate";
import {
  LANES,
  createDemoProject,
  parseDTX,
  serializeDTX,
  channelToLane,
  isAudioChannel,
  GUITAR_CHANNELS,
  BASS_CHANNELS,
  stringChannel,
  type Project,
  type Note,
} from "./chart";
import { buildTimelineIndex, type TimelineIndex } from "./timeline";
import { trimReferenceAudio } from "./wave";
import { createLibraryUI } from "./library-ui";
import { openBeatDialog } from "./beat-ui";
import { createMidiUI } from "./midi-ui";
import { recordingBeat } from "./midi-input";
import { AudioTransport, synthesizeKitWav } from "./audio";
import {
  ProjectStore,
  importFiles,
  normalizePath,
  hashBlob,
  storageEstimate,
  type ImportedFile,
} from "./storage";
import {
  FRET_DESCRIPTORS,
  channelForFrets,
  setStringFrets,
} from "./guitar-view";
import {
  CREATOR_LANES,
  creatorLaneForChannel,
  getResourceAppearance,
  setResourceAppearance,
  getCreatorPalette,
  setCreatorPalette,
  getCreatorBindings,
  setCreatorBinding,
  remapCreatorReferences,
  type CreatorBank,
} from "./creator-settings";
import {
  validateProjectManifest,
  safeUnzip,
  safeAssetPath,
  rebaseImportedChart,
  resolveImportedAssetPath,
} from "./import-export";
import { KIT_PRESETS, loadKit, type KitId } from "./kits";
import { parseChartBytes } from "./io";
import { getMediaResources, resolveMediaFile } from "./media";
import {
  simplifyMusically,
  requestDifficulty,
  requestDifficultyVariants,
  requestMetadata,
  type AIProposal,
} from "./ai";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const uid = () => crypto.randomUUID();
const store = new ProjectStore();
const transport = new AudioTransport();
let project = createDemoProject(),
  files: ImportedFile[] = [],
  projectId: string | undefined,
  dirty = false,
  selection = new Set<string>(),
  clipboard: Note[] = [],
  undoStack: Project[] = [],
  redoStack: Project[] = [];
let resourceId = "02",
  grid = 4,
  zoom = 40,
  mode: "draw" | "select" | "erase" = "draw",
  group = "drums",
  customChannels = ["01", "03", "08", "53"],
  activeTab = "chart",
  follow = true,
  cursorBeat = 0,
  cursorLane = 0,
  loopStart = 0,
  loopEnd = 8,
  loopOn = false,
  referencePath = "",
  youtubeId = "",
  waveform: Float32Array | null = null,
  referenceDuration = 0,
  aiProposal: AIProposal | null = null,
  aiController: AbortController | undefined;
let autoLaneSound = true;
let placementPreview = true;
let bgmOnly = false;
let auditionId = "";
let backSide = false;
let defaultLaneSounds: Record<string, string> = {};
let selectedBank = "WAV",
  filter = "",
  dragStart: { beat: number; lane: number; x: number; y: number } | null = null,
  dragMoved = false,
  drawn = false,
  toastTimer: ReturnType<typeof setTimeout>,
  autosaveTimer: ReturnType<typeof setTimeout>,
  assetURLs = new Map<string, string>();
const aliases: Record<string, string> = { SN: "SD", LP: "HH" };
const app = $("app");
app.innerHTML = `
<header class="topbar"><div class="brand"><div class="mark"><div class="logo-bars"><i></i><i></i><i></i><i></i></div></div><strong>DTX <span>STUDIO</span></strong></div><span class="badge">LOCAL FIRST</span><div class="project-title" id="project-title"></div><div class="top-actions"><button id="new" class="ghost hide-phone">新規</button><button id="open">開く</button><button id="save">保存 <span class="hide-mid">⌘ / Ctrl S</span></button><button id="export" class="primary">DTX 書き出し ↗</button><button id="settings" class="ghost" aria-label="設定">⚙</button></div></header>
<section class="transport"><button id="play" class="primary play" aria-label="再生 / 一時停止">▶</button><button id="stop" aria-label="先頭に戻す">■</button><div class="time" id="time">00:00.000<small>BAR 001 · BEAT 1.00</small></div><div class="divider"></div><label>BPM <input id="bpm" type="number" min="1" max="999" step=".1"></label><button id="tap" class="ghost hide-small" title="4 回以上タップして BPM 推定">TAP</button><label>速度 <select id="speed"><option value=".25">0.25×</option><option value=".5">0.50×</option><option value=".75">0.75×</option><option value="1" selected>1.00×</option><option value="1.25">1.25×</option><option value="1.5">1.50×</option></select></label><label class="hide-small"><input type="checkbox" id="metro">メトロノーム</label><div class="spacer"></div><button id="loop" title="A/B ループ">↻ LOOP</button><label class="hide-small">A <input id="loop-a" type="number" min="0" step=".25" value="0" title="ループ開始拍"></label><label class="hide-small">B <input id="loop-b" type="number" min=".25" step=".25" value="8" title="ループ終了拍"></label><button id="mobile-inspector" class="mobile-inspector" style="display:none">詳細</button></section>
<div class="mobile-notice">編集は PC 推奨 · スマートフォンでは横向きでご利用ください</div>
<main class="workbench"><aside class="sidebar leftbar" id="leftbar"><div class="panel-head"><h2>音源ライブラリ</h2><span class="small muted" id="asset-count"></span></div><div class="panel-body"><div class="row"><select id="bank" class="grow"><option>WAV</option><option>BMP</option><option>BMPTEX</option><option>AVI</option></select><button id="add-resource" title="リソース定義を追加">＋</button></div><select id="kit-select" aria-label="内蔵ドラムキット"><option value="">内蔵 MIDI キットを選ぶ…</option><option value="standard">Standard · アコースティック</option><option value="electronic">Electronic · 電子ドラム</option><option value="jazz">Jazz · ジャズ</option></select><label class="check-row"><input id="auto-lane" type="checkbox" checked>レーンに合う音源を自動選択</label><input id="resource-filter" placeholder="名前・ID で検索" aria-label="音源検索"><div id="palette" class="row wrap"></div><div id="samples" class="sample-list"></div><div class="resource-tools"><button id="import-audio">音源を追加</button><button id="import-folder">フォルダから抽出</button><button id="edit-resource">定義を編集</button><button id="reorder-resource">ID を変更</button><button id="palette-add">★ お気に入り</button><button id="bindings">レーン音源割当</button><button id="palette-setup">パレット設定</button><button id="sound-collections">音源コレクション</button></div><div class="note-box">音源や譜面はこの端末だけに保存。別の曲のフォルダから、音源だけを取り込むこともできます。</div><div class="section-title">選択中の音源</div><div id="resource-info" class="safety-note"></div><button id="manage-assets" class="ghost wide">ファイル・容量を管理 →</button><div class="section-title">QUICK START</div><div class="safety-note">① 原曲を読み込む<br>② BPM と拍の位置を合わせる<br>③ グリッドをクリックして打ち込む<br>④ ループで聴き比べて調整</div><button id="help" class="ghost wide">ショートカット・使い方</button></div></aside>
<section class="timeline-area"><div class="toolbar"><button id="mobile-samples" class="mobile-samples" style="display:none">音源</button><button id="mode-draw" class="active" title="鉛筆 (P)">✎ 打ち込み</button><button id="mode-select" title="選択 (V)">↖ 選択</button><button id="mode-erase" title="消去 (E)">消去</button><div class="divider" style="height:20px"></div><button id="undo" title="元に戻す Ctrl+Z">↶</button><button id="redo" title="やり直し Ctrl+Shift+Z">↷</button><label>グリッド <select id="grid"><option value="1">1/4</option><option value="2">1/8</option><option value="3">1/12</option><option value="4" selected>1/16</option><option value="6">1/24</option><option value="8">1/32</option><option value="12">1/48</option><option value="16">1/64</option><option value="0">自由</option></select></label><div class="spacer"></div><label class="hide-phone">ズーム <input id="zoom" type="range" min="16" max="110" value="40" style="width:70px"></label><button id="follow" class="active" title="再生位置を追従">追従</button></div>
<div class="reference-strip"><div class="row"><span class="eyebrow">REFERENCE AUDIO</span><span class="small muted grow" id="reference-name">原曲を追加して、同じ時間軸で耳コピ</span><button id="reference-open" style="font-size:10px;padding:5px 8px">＋ 音声</button><button id="youtube-open" style="font-size:10px;padding:5px 8px">YouTube</button><button id="reference-clear" class="ghost" style="font-size:10px;padding:5px" title="原曲の参照を解除">×</button></div><canvas id="waveform" class="waveform" aria-label="全曲の波形・シークバー"></canvas></div>
<div class="toolbar-secondary"><select id="lane-group"><option value="drums">DRUMS · 4 CYMBALS</option><option value="guitar">GUITAR</option><option value="bass">BASS</option><option value="media">BGA / AVI / BGM</option><option value="effects">FILL / BONUS / MUTE</option><option value="hidden">DRUMS · 非表示チップ</option><option value="media-alt">BGA · スコープ差替</option><option value="string-extra">G/B · 空打ち音</option><option value="se1">SE 1–16</option><option value="se2">SE 17–32</option><option value="custom">任意チャンネル</option></select><button id="channels">レーン設定</button><span class="spacer"></span><span id="selection-count">0 ノート選択</span><button id="quantize">整列</button><button id="back-side" title="表 / 裏チャンネル">表</button><button id="more-edit">編集操作 ▾</button></div><div id="lane-head" class="lane-head"></div><div id="chart-scroll" class="chart-scroll"><div id="chart-space" style="position:relative"><canvas id="chart" class="chart-canvas" aria-label="譜面編集グリッド" tabindex="0"></canvas></div></div></section>
<aside class="sidebar rightbar" id="rightbar"><div class="tabs"><button data-tab="chart" class="active">譜面</button><button data-tab="assist">耳コピ</button><button data-tab="ai">AI</button></div><div class="panel-body" id="inspector"></div></aside></main>
<footer class="statusbar"><span class="dot"></span><span id="save-state">ローカルで作成中</span><span id="status-notes"></span><button id="midi-record-status" hidden class="danger">● MIDI 録音待機</button><span class="spacer"></span><span>クリックで配置 · 右クリックで消去 · Space 再生</span><span class="badge-neutral badge">DTXManiaNX</span></footer><input id="file-input" type="file" multiple hidden><input id="folder-input" type="file" webkitdirectory multiple hidden><input id="reference-input" type="file" accept="audio/*,.ogg,.wav,.mp3,.flac,.m4a" hidden><div id="modal-root"></div>`;
function toast(message: string, error = false) {
  clearTimeout(toastTimer);
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.textContent = message;
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), error ? 7500 : 3500);
}
function handleError(e: unknown) {
  console.error(e instanceof Error ? e.message : "Operation failed");
  toast(e instanceof Error ? e.message : String(e), true);
}
function editable() {
  if (project.readOnlyReason) {
    toast(project.readOnlyReason, true);
    return false;
  }
  return true;
}
const historyState = new WeakMap<
  Project,
  { referenceOffset: number; referenceBgmId: string }
>();
function historySnapshot() {
  const snapshot = structuredClone(project);
  historyState.set(snapshot, {
    referenceOffset: transport.referenceOffset,
    referenceBgmId,
  });
  return snapshot;
}
function restoreHistoryState(p: Project) {
  const state = historyState.get(p);
  if (state) {
    transport.setReferenceOffset(state.referenceOffset);
    referenceBgmId = state.referenceBgmId;
  }
}
function checkpoint() {
  if (!editable()) return false;
  undoStack.push(historySnapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  return true;
}
let revision = 0;
let timelineCache: TimelineIndex | undefined,
  timelineProject: Project | undefined,
  timelineRevision = -1;
function timeline(p: Project) {
  if (
    p !== timelineProject ||
    timelineRevision !== revision ||
    !timelineCache
  ) {
    timelineCache = buildTimelineIndex(p);
    timelineProject = p;
    timelineRevision = revision;
  }
  return timelineCache;
}
const beatToSeconds = (p: Project, b: number) => timeline(p).beatToSeconds(b);
const secondsToBeat = (p: Project, s: number) => timeline(p).secondsToBeat(s);
const durationBeats = (p: Project) => timeline(p).durationBeats();
const barStartBeat = (p: Project, b: number) => timeline(p).barStartBeat(b);
const barLengthAt = (p: Project, b: number) =>
  timeline(p).barLengthAt(Math.min(3599, b));
const beatToBar = (p: Project, b: number) =>
  timeline(p).beatToBar(
    Math.min(timeline(p).barStartBeat(3600) - 1e-8, Math.max(0, b)),
  );
let referenceBgmId = "";
let sourceChartPath = "";
let saveQueue: Promise<void> = Promise.resolve();
function changed() {
  revision++;
  dirty = true;
  aiProposal = null;
  render();
  syncTransport();
  void syncSamples();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveProject(true), 1600);
}
function setProject(p: Project) {
  referenceGeneration++;
  if (!p.readOnlyReason) sourceChartPath = "";
  referenceBgmId = "";
  defaultLaneSounds = {};
  for (const n of p.notes) {
    const lane =
      n.channel === "18"
        ? "OH"
        : n.channel === "1C"
          ? "LB"
          : channelToLane(n.channel);
    if (lane && !defaultLaneSounds[lane]) defaultLaneSounds[lane] = n.value;
  }
  revision++;
  clearTimeout(autosaveTimer);
  transport.pause();
  project = p;
  undoStack = [];
  redoStack = [];
  selection.clear();
  resourceId = Object.keys(project.resources)[0] || "01";
  cursorBeat = 0;
  dirty = false;
  aiProposal = null;
  render();
  syncSamples();
  transport.seek(0);
  $("chart-scroll").scrollTop = 0;
}
function title() {
  return project.metadata.title || "名称未設定の譜面";
}
function render() {
  $("project-title").innerHTML =
    `${esc(title())}<small>${esc(project.metadata.artist || "アーティスト未設定")} <span class="${dirty ? "dirty" : ""}">${dirty ? "· 未保存" : "· ローカル"}</span></small>`;
  ($("bpm") as HTMLInputElement).value = String(project.metadata.bpm);
  $("save-state").textContent = dirty
    ? "変更あり · 自動保存待ち"
    : "ローカルに保存";
  $("status-notes").textContent =
    `${project.notes.length} チップ · ${project.barCount} 小節`;
  $("selection-count").textContent = `${selection.size} ノート選択`;
  ($("undo") as HTMLButtonElement).disabled = !undoStack.length;
  ($("redo") as HTMLButtonElement).disabled = !redoStack.length;
  renderResources();
  renderInspector();
  renderLanes();
  drawChart();
  drawWaveform();
}
function bankResources() {
  return getMediaResources(
    project,
    selectedBank as "WAV" | "BMP" | "BMPTEX" | "AVI",
  );
}
function findFile(path: string) {
  const exact = files.find(
    (f) => f.path.toLowerCase() === path.replace(/\\/g, "/").toLowerCase(),
  );
  if (exact) return exact;
  if (sourceChartPath) {
    try {
      path = resolveImportedAssetPath(path, sourceChartPath);
    } catch {
      return undefined;
    }
  }
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase();
  return files.find((f) => f.path.toLowerCase() === normalized);
}
function renderResources() {
  $("palette").hidden = localStorage.getItem("dtx-palette-hidden") === "1";
  $("palette").innerHTML = getCreatorPalette(project)
    .map(
      (e) =>
        `<button data-palette="${esc(e.bank)}:${esc(e.id)}" style="font-size:10px;padding:4px 6px">★ ${esc(e.id)}</button>`,
    )
    .join("");
  const resources = bankResources().filter((r) =>
    (r.file + " " + r.id).toLowerCase().includes(filter.toLowerCase()),
  );
  $("asset-count").textContent = `${files.length} FILES`;
  $("samples").innerHTML = resources.length
    ? resources
        .map((r) => {
          const lane =
            LANES.find((l) =>
              project.notes.some(
                (n) => n.value === r.id && channelToLane(n.channel) === l.id,
              ),
            ) || LANES[1];
          const appearance = getResourceAppearance(
            project,
            selectedBank as CreatorBank,
            r.id,
          );
          return `<div class="sample ${resourceId === r.id ? "selected" : ""}" style="${appearance.background ? `background:${esc(appearance.background)};` : ""}" data-resource="${esc(r.id)}" tabindex="0"><div class="sample-dot" style="background:${appearance.foreground || lane.color}"></div><div class="grow"><div class="sample-name">${esc(appearance.label || r.file.split(/[\\/]/).at(-1) || "未割当")}</div><div class="sample-id">${esc(selectedBank)} ${esc(r.id)} · ${findFile(r.file) ? "読込済み" : "ファイル未読込"}</div></div><button class="audition" data-audition="${esc(r.id)}" title="試聴">▷</button></div>`;
        })
        .join("")
    : '<div class="empty">このバンクには定義がありません</div>';
  const r = bankResources().find((r) => r.id === resourceId);
  $("resource-info").innerHTML = r
    ? `<b>${esc(selectedBank)} ${esc(r.id)}</b><br>${esc(r.file || "ファイル未割当")}<br>${selectedBank === "WAV" ? `音量 ${project.resources[r.id]?.volume ?? 100}% · パン ${project.resources[r.id]?.pan ?? 0}` : "画像・動画はプレビューから確認できます"}`
    : "音源を選択してください";
}
function currentLanes() {
  if (group === "guitar" || group === "bass")
    return [
      {
        id: "OPEN",
        label: "開放",
        channel: group === "guitar" ? "20" : "A0",
        color: "#e5e5e5",
      },
      ...FRET_DESCRIPTORS.map((f) => ({
        id: f.key,
        label: f.key,
        channel: channelForFrets(group as "guitar" | "bass", [f.index]),
        color: f.color,
      })),
      {
        id: "WAIL",
        label: "ウェイリング",
        channel: group === "guitar" ? "28" : "A8",
        color: "#f1c27b",
      },
      {
        id: "HOLD",
        label: "ホールド",
        channel: group === "guitar" ? "2C" : "2D",
        color: "#d2d0f4",
      },
    ];
  if (group === "drums")
    return LANES.flatMap((l) =>
      l.id === "LP"
        ? [
            { ...l, channel: String(l.channel) },
            {
              id: "LB",
              label: "左バスドラム",
              channel: "1C",
              color: "#af93ed",
            },
          ]
        : [{ ...l, channel: String(l.channel) }],
    );
  const channels =
    group === "guitar"
      ? GUITAR_CHANNELS.filter(
          (c) =>
            c.kind === "open" ||
            (c.kind === "note" && c.frets.length === 1) ||
            c.kind === "hold",
        ).map((c) => c.channel)
      : group === "bass"
        ? BASS_CHANNELS.filter(
            (c) =>
              c.kind === "open" ||
              (c.kind === "note" && c.frets.length === 1) ||
              c.kind === "hold",
          ).map((c) => c.channel)
        : group === "hidden"
          ? [
              "31",
              "32",
              "33",
              "34",
              "35",
              "36",
              "37",
              "38",
              "39",
              "3A",
              "3B",
              "3C",
            ]
          : group === "media-alt"
            ? ["C4", "C7", "D5", "D6", "D7", "D8", "D9", "E0"]
            : group === "string-extra"
              ? [...GUITAR_CHANNELS, ...BASS_CHANNELS]
                  .filter((c) => c.kind === "noChip" || c.kind === "wailSound")
                  .map((c) => c.channel)
              : group === "media"
                ? [
                    "01",
                    "04",
                    "07",
                    "54",
                    "5A",
                    "55",
                    "56",
                    "57",
                    "58",
                    "59",
                    "60",
                  ]
                : group === "effects"
                  ? ["53", "4F", "4E", "4D", "4C", "84", "85", "86", "87"]
                  : group === "se1"
                    ? Array.from({ length: 16 }, (_, i) => String(61 + i))
                    : group === "se2"
                      ? Array.from({ length: 16 }, (_, i) => String(77 + i))
                      : customChannels;
  const names: Record<string, string> = {
    "01": "BGM",
    "03": "BPM",
    "08": "BPM拡張",
    "04": "BGA",
    "07": "BG2",
    "54": "AVI",
    "5A": "AVI全画面",
    "53": "FILL",
    "84": "MHH",
    "85": "MCY",
    "86": "MRD",
    "87": "MLC",
    "4F": "BONUS",
  };
  return channels.map((channel, i) => ({
    id: channel,
    label: stringChannel(channel)?.pattern || names[channel] || `CH ${channel}`,
    channel,
    color: ["#8ddbaa", "#f1b77e", "#90b8ed", "#e699c3"][i % 4],
  }));
}
function noteLaneIndices(note: Note) {
  if (group === "guitar" || group === "bass") {
    const info = stringChannel(note.channel);
    if (!info || info.instrument !== group) return [];
    if (info.kind === "open") return [0];
    if (info.kind === "hold") return [7];
    if (info.kind === "wail" || info.kind === "wailSound") return [6];
    return info.frets.map((f) => f + 1).filter((i) => i > 0);
  }
  const lanes = currentLanes();
  const i =
    group === "drums"
      ? lanes.findIndex(
          (l) =>
            l.id ===
            (note.channel === "1C" ? "LB" : channelToLane(note.channel)),
        )
      : lanes.findIndex((l) => l.channel === note.channel);
  return i >= 0 ? [i] : [];
}
function laneIndex(note: Note) {
  return noteLaneIndices(note)[0] ?? -1;
}
function renderLanes() {
  const lanes = currentLanes();
  $("lane-head").style.gridTemplateColumns = `repeat(${lanes.length},1fr)`;
  $("lane-head").innerHTML = lanes
    .map(
      (l, i) =>
        `<div class="lane-title" style="color:${l.color}">${esc(l.id)}<small>${esc(group === "drums" ? ["A", "S", "D", "Z", "F", "G", "H", "J", "K", "L", ";"][i] : l.channel)}</small></div>`,
    )
    .join("");
}
const geometry = () => {
  const scroller = $("chart-scroll");
  return {
    width: scroller.clientWidth || 650,
    left: 66,
    right: 14,
    lanes: currentLanes(),
    height: Math.max(500, durationBeats(project) * zoom + 80),
    viewHeight: Math.max(300, scroller.clientHeight),
    scroll: scroller.scrollTop,
  };
};
let holdCache: ReturnType<typeof getHoldSpans> = [];
let holdRevision = -1;
function drawChart() {
  const c = $("chart") as HTMLCanvasElement,
    g = geometry(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  $("chart-space").style.height = g.height + "px";
  c.style.height = g.viewHeight + "px";
  c.style.position = "absolute";
  c.style.top = g.scroll + "px";
  if (
    c.width !== Math.round(g.width * dpr) ||
    c.height !== Math.round(g.viewHeight * dpr)
  ) {
    c.width = Math.round(g.width * dpr);
    c.height = Math.round(g.viewHeight * dpr);
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, -g.scroll * dpr);
  ctx.fillStyle = "#111823";
  ctx.fillRect(0, 0, g.width, g.height);
  const laneW = (g.width - g.left - g.right) / g.lanes.length;
  for (let i = 0; i < g.lanes.length; i++) {
    ctx.fillStyle = i % 2 ? "#151f2d" : "#121b28";
    ctx.fillRect(g.left + i * laneW, 0, laneW, g.height);
    ctx.strokeStyle = "#263247";
    ctx.beginPath();
    ctx.moveTo(g.left + i * laneW, 0);
    ctx.lineTo(g.left + i * laneW, g.height);
    ctx.stroke();
  }
  const max = durationBeats(project);
  for (
    let beat = Math.max(
      0,
      Math.floor(((g.scroll - 20) / zoom) * (grid || 4)) / (grid || 4),
    );
    beat <= Math.min(max, (g.scroll + g.viewHeight) / zoom + 1);
    beat += 1 / (grid || 4)
  ) {
    const whole = Math.abs(beat - Math.round(beat)) < 0.001;
    ctx.strokeStyle = whole ? "#2a3950" : "#1e2a3c";
    ctx.lineWidth = whole ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(g.left, beat * zoom + 20);
    ctx.lineTo(g.width - g.right, beat * zoom + 20);
    ctx.stroke();
  }
  const firstBar = Math.max(
    0,
    beatToBar(project, Math.max(0, (g.scroll - 20) / zoom)).bar,
  );
  for (let bar = firstBar; bar <= project.barCount; bar++) {
    const y = barStartBeat(project, bar) * zoom + 20;
    if (
      y + 4 * barLengthAt(project, bar) * zoom < g.scroll ||
      y > g.scroll + g.viewHeight
    ) {
      if (y > g.scroll + g.viewHeight) break;
      continue;
    }
    ctx.fillStyle = bar % 2 ? "#1d2b3e" : "#182536";
    ctx.fillRect(0, y, g.left, 4 * barLengthAt(project, bar) * zoom);
    ctx.fillStyle = "#aec0da";
    ctx.font = "bold 11px ui-monospace";
    ctx.fillText(String(bar + 1).padStart(3, "0"), 13, y + 16);
    ctx.font = "9px sans-serif";
    ctx.fillStyle = "#61738d";
    ctx.fillText(`${4 * barLengthAt(project, bar)}/4`, 15, y + 30);
    ctx.strokeStyle = "#4a5b72";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(g.width - g.right, y);
    ctx.stroke();
  }
  if (loopOn) {
    ctx.fillStyle = "#a4ef7709";
    ctx.fillRect(
      g.left,
      loopStart * zoom + 20,
      g.width - g.left - g.right,
      (loopEnd - loopStart) * zoom,
    );
    for (const [beat, label] of [
      [loopStart, "A"],
      [loopEnd, "B"],
    ] as const) {
      const y = beat * zoom + 20;
      ctx.strokeStyle = "#90c16f";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(g.left, y);
      ctx.lineTo(g.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#b9e498";
      ctx.fillText(label, 50, y - 4);
    }
  }
  if (group === "guitar" || group === "bass")
    for (const span of holdRevision === revision
      ? holdCache
      : ((holdRevision = revision), (holdCache = getHoldSpans(project)))) {
      if (
        span.instrument !== group ||
        span.end.beat * zoom < g.scroll ||
        span.start.beat * zoom > g.scroll + g.viewHeight
      )
        continue;
      for (const index of noteLaneIndices(span.start)) {
        ctx.fillStyle = g.lanes[index].color + "55";
        ctx.fillRect(
          g.left + index * laneW + laneW * 0.3,
          span.start.beat * zoom + 20,
          laneW * 0.4,
          (span.end.beat - span.start.beat) * zoom,
        );
      }
    }
  for (const n of project.notes) {
    if (
      n.beat * zoom + 40 < g.scroll ||
      n.beat * zoom > g.scroll + g.viewHeight
    )
      continue;
    const indices = noteLaneIndices(n);
    for (const i of indices) {
      const x = g.left + i * laneW + 3,
        y = n.beat * zoom + 20,
        w = laneW - 6,
        chosen = selection.has(n.id);
      ctx.fillStyle = chosen ? "#f9ffe9" : g.lanes[i].color;
      ctx.globalAlpha =
        aiProposal && !aiProposal.keepIds.includes(n.id) ? 0.22 : 1;
      ctx.fillRect(x, y - 4, w, 8);
      ctx.fillStyle = "#0005";
      ctx.fillRect(x, y + 2, w, 2);
      if (chosen) {
        ctx.strokeStyle = "#faffd4";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 2, y - 6, w + 4, 12);
      }
      if (zoom >= 40) {
        ctx.fillStyle = chosen ? "#dfeeca" : "#7488a4";
        ctx.font = "8px ui-monospace";
        ctx.fillText(
          n.value +
            (n.channel === "18" ? " ○" : n.channel === "1C" ? " L" : ""),
          x + 2,
          y + 16,
        );
      }
      ctx.globalAlpha = 1;
    }
  }
  for (const t of project.tempos) {
    const y = t.beat * zoom + 20;
    ctx.fillStyle = "#f4c16f";
    ctx.fillRect(g.left - 3, y - 3, 6, 6);
    ctx.font = "9px ui-monospace";
    ctx.fillText(String(t.bpm), 3, y - 4);
  }
  const playBeat = transport.isPlaying
    ? secondsToBeat(project, transport.currentTime)
    : cursorBeat;
  const y = playBeat * zoom + 20;
  ctx.fillStyle = "#b4ef8d";
  ctx.fillRect(g.left - 7, y - 5, 7, 10);
  ctx.strokeStyle = "#b4ef8d";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(g.left, y);
  ctx.lineTo(g.width, y);
  ctx.stroke();
  if (dragStart && dragMoved && mode === "select" && !dragMoving) {
    const d = dragCurrent;
    ctx.strokeStyle = "#c9f79c";
    ctx.fillStyle = "#9bdc5c22";
    ctx.fillRect(
      Math.min(dragStart.x, d.x),
      Math.min(dragStart.y, d.y),
      Math.abs(d.x - dragStart.x),
      Math.abs(d.y - dragStart.y),
    );
    ctx.strokeRect(
      Math.min(dragStart.x, d.x),
      Math.min(dragStart.y, d.y),
      Math.abs(d.x - dragStart.x),
      Math.abs(d.y - dragStart.y),
    );
  }
}
let dragCurrent = { x: 0, y: 0 };
let dragMoving = false;
let dragOriginal: Note[] = [];
function drawWaveform() {
  const c = $("waveform") as HTMLCanvasElement,
    w = c.clientWidth,
    h = 46;
  c.width = w * 2;
  c.height = h * 2;
  const ctx = c.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = "#182332";
  ctx.fillRect(0, 0, w, h);
  const duration = Math.max(
    Math.max(0, referenceDuration - transport.referenceOffset),
    beatToSeconds(project, durationBeats(project)),
    1,
  );
  ctx.strokeStyle = waveform ? "#688764" : "#3b4d62";
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const sourceTime = (x / w) * duration + transport.referenceOffset;
    const peak =
      waveform && sourceTime >= 0 && sourceTime < referenceDuration
        ? waveform[
            Math.min(
              waveform.length - 1,
              Math.floor((sourceTime / referenceDuration) * waveform.length),
            )
          ]
        : 0.03;
    ctx.moveTo(x, h / 2 - peak * 18);
    ctx.lineTo(x, h / 2 + peak * 18);
  }
  ctx.stroke();
  if (loopOn) {
    ctx.fillStyle = "#a4ef7720";
    const a = (beatToSeconds(project, loopStart) / duration) * w,
      b = (beatToSeconds(project, loopEnd) / duration) * w;
    ctx.fillRect(a, 0, b - a, h);
  }
  const at = (transport.currentTime / duration) * w;
  ctx.fillStyle = "#b9f893";
  ctx.fillRect(at, 0, 2, h);
  ctx.font = "9px ui-monospace";
  ctx.fillStyle = "#8eabc0";
  ctx.fillText("0:00", 5, 12);
  ctx.fillText(formatTime(duration).slice(0, 5), Math.max(0, w - 42), 12);
}
function formatTime(time: number) {
  time = Math.max(0, time);
  return `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(Math.floor(time % 60)).padStart(2, "0")}.${String(Math.floor((time % 1) * 1000)).padStart(3, "0")}`;
}
function syncTransport() {
  const was = transport.isPlaying;
  const t = transport.currentTime;
  const bgmIds = new Set(
    project.passthrough
      .map((line) =>
        line.match(/^#BGMWAV\s*:?\s*([0-9A-Z]{2})/i)?.[1]?.toUpperCase(),
      )
      .filter(Boolean),
  );
  transport.setEvents(
    project.notes
      .filter(
        (n) =>
          (isAudioChannel(n.channel) ||
            ["84", "85", "86", "87"].includes(n.channel)) &&
          (!bgmOnly || n.channel === "01" || bgmIds.has(n.value)) &&
          !(
            n.channel === "01" &&
            referencePath &&
            (project.resources[n.value]?.file === referencePath ||
              n.value === referenceBgmId)
          ),
      )
      .map((n) => ({
        time: beatToSeconds(project, n.beat),
        resourceId: n.value,
        channel: n.channel,
        kind: bgmIds.has(n.value) ? ("bgm" as const) : undefined,
        lane:
          aliases[channelToLane(n.channel) || ""] || channelToLane(n.channel),
        volume: (project.resources[n.value]?.volume ?? 100) / 100,
        pan: (project.resources[n.value]?.pan ?? 0) / 100,
      })),
    beatToSeconds(project, durationBeats(project)),
  );
  transport.setMetronome(
    project.metadata.bpm,
    ($("metro") as HTMLInputElement).checked,
  );
  transport.setMetronomeTimeline([...timeline(project).metronomeEvents()]);
  updateLoop();
  if (was && !transport.isPlaying) {
    transport.seek(t);
    transport.play().catch(handleError);
  }
}
let sampleSignature = "";
let sampleGeneration = 0;
let loadedSamples = new Map<string, string>();
async function syncSamples() {
  const resources = Object.values(project.resources).map((r) => ({
    ...r,
    asset: findFile(r.file),
  }));
  const signature = JSON.stringify(
    resources.map((r) => [r.id, r.file, r.asset?.hash]),
  );
  if (signature === sampleSignature) return;
  sampleSignature = signature;
  const generation = ++sampleGeneration;
  const ids = new Set(resources.filter((r) => r.asset).map((r) => r.id));
  if ([...loadedSamples.keys()].some((id) => !ids.has(id))) {
    transport.clearSamples();
    loadedSamples.clear();
  }
  for (const r of resources) {
    if (generation !== sampleGeneration) return;
    if (r.asset && loadedSamples.get(r.id) !== r.asset.hash)
      try {
        await transport.loadSample(r.id, r.asset.blob);
        if (generation === sampleGeneration)
          loadedSamples.set(r.id, r.asset.hash);
      } catch {}
  }
  if (generation === sampleGeneration) syncTransport();
}

function updateLoop() {
  loopStart = Number(($("loop-a") as HTMLInputElement).value);
  loopEnd = Number(($("loop-b") as HTMLInputElement).value);
  if (loopOn && loopEnd <= loopStart) {
    toast("ループ終点は始点より後にしてください", true);
    loopOn = false;
  }
  $("loop").classList.toggle("active", loopOn);
  transport.setLoop(
    loopOn
      ? {
          start: beatToSeconds(project, loopStart),
          end: beatToSeconds(project, loopEnd),
        }
      : null,
  );
  drawChart();
  drawWaveform();
}
function renderInspector() {
  const box = $("inspector");
  if (activeTab === "chart") {
    const chosen = project.notes.filter((n) => selection.has(n.id));
    box.innerHTML = `<div><div class="eyebrow">CHART OVERVIEW</div><h2 style="font-size:16px;margin-top:7px">譜面を組み立てる</h2></div><div class="stat-grid"><div class="stat"><b>${project.notes.filter((n) => channelToLane(n.channel)).length}</b><span>DRUM NOTES</span></div><div class="stat"><b>${project.barCount}</b><span>MEASURES</span></div><div class="stat"><b>${Math.round(beatToSeconds(project, durationBeats(project)))}</b><span>SECONDS</span></div></div>${project.readOnlyReason ? `<div class="note-box warning">${esc(project.readOnlyReason)}</div>` : ""}<button id="metadata" class="wide">曲情報・難易度・プレビュー画像</button><div class="section-title">選択したチップ</div>${chosen.length ? `<div class="inspector-card"><div class="row"><b>${chosen.length} チップ</b><span class="spacer"></span><button id="delete-notes" class="danger" style="font-size:10px">削除</button></div><div class="field-grid" style="margin-top:12px"><label class="stack">位置（拍）<input id="note-beat" type="number" min="0" step=".25" value="${chosen[0].beat}"></label><label class="stack">WAV / 値<input id="note-value" value="${chosen.every((n) => n.value === chosen[0].value) ? esc(chosen[0].value) : ""}" placeholder="混在・変更しない" maxlength="2"></label><label class="stack">チャンネル<input id="note-channel" value="${chosen.every((n) => n.channel === chosen[0].channel) ? esc(chosen[0].channel) : ""}" placeholder="混在・変更しない" maxlength="2"></label><label class="stack">サイズ (%)<input id="note-size" type="number" min="1" max="200" value="" placeholder="変更しない"></label></div>${chosen.some((n) => ["note", "open"].includes(stringChannel(n.channel)?.kind || "")) ? `<div class="row wrap" style="margin-top:10px">${FRET_DESCRIPTORS.map((f) => `<label class="check-row" style="color:${f.color}"><input type="checkbox" data-fret="${f.index}" ${stringChannel(chosen[0].channel)?.frets.includes(f.index) ? "checked" : ""}>${f.key}</label>`).join("")}</div><button id="apply-frets" class="wide" style="margin-top:7px">フレット組合せを適用</button><button id="edit-hold" class="wide">ホールド区間を設定</button>` : ""}<button id="apply-note" class="wide" style="margin-top:10px">選択に適用</button><div class="small muted" style="margin-top:7px">複数選択の位置は相対移動。サイズは同じ WAV 定義の全チップに反映。</div></div>` : '<div class="note-box">選択ツールでノートをクリック。Shift で追加、ドラッグで範囲選択。位置・音源・チャンネルをまとめて編集できます。</div>'}<div class="section-title">小節・テンポ</div><div class="row"><label>小節 <input id="bar-index" class="measure-input" type="number" min="1" value="${beatToBar(project, cursorBeat).bar + 1}"></label><button id="bar-edit">編集</button><button id="tempo-add">BPM ＋</button></div><div class="mini-list">${project.tempos.map((t) => `<div><span class="grow">${t.beat.toFixed(2)} 拍 → ${t.bpm} BPM</span><button data-remove-tempo="${esc(t.id)}">×</button></div>`).join("") || '<span class="muted">途中のテンポ変更はありません</span>'}</div><button id="source" class="ghost wide">DTX テキストを編集 ↗</button><div class="section-title">IMPORT CHECK</div><div class="safety-note">${project.warnings.length ? project.warnings.map((w) => `• ${esc(w)}`).join("<br>") : "基本構造を解析済み。ゲーム側での最終確認も行ってください。"}</div>`;
  } else if (activeTab === "assist") {
    box.innerHTML = `<div><div class="eyebrow">TRANSCRIPTION TOOLS</div><h2 style="font-size:16px;margin-top:7px">聴き取ることに集中</h2></div><div class="note-box">短い区間をループし、拍の位置を合わせてから打ち込みます。ローカル音源の低速再生はピッチも変わります。</div><div class="section-title">A / B LOOP</div><div class="row"><button id="mark-a" class="grow">現在位置を A</button><button id="mark-b" class="grow">現在位置を B</button></div><button id="loop-selection" class="wide">選択範囲をループ</button><div class="section-title">ミックス</div><label class="stack">譜面音量<input id="drum-volume" type="range" min="0" max="100" value="80"></label><label class="stack">原曲音量<input id="reference-volume" type="range" min="0" max="100" value="70"></label><label class="stack">譜面音の遅延調整 (ms)<input id="latency" type="number" min="-1000" max="1000" step="5" value="${transport.latencyOffset * 1000}"></label><div class="small muted">正数で譜面音を遅らせます。YouTube はフレーム・通信の制約があり、厳密な音合わせにはローカル音源を推奨。</div><div class="section-title">拍の位置を合わせる</div><label class="stack">原曲の先頭オフセット (秒)<input id="reference-offset" type="number" step=".01" value="${transport.referenceOffset}"></label><div class="small muted">+10 は原曲の 10 秒目を譜面 0 拍に合わせます。負数は原曲の開始を遅らせます。途中の BPM 変化は先頭移動では補正できません。拍アンカーまたは途中の BPM 変更を使います。</div><button id="reference-bgm" class="wide">参照音声を BGM チップに登録</button><button id="shift-chart" class="wide">全チップをまとめて移動</button><button id="tap-assist" class="wide">TAP BPM を測る</button><button id="beat-analysis" class="wide">BPM・拍を自動解析 / 拍アンカー</button><button id="midi-live" class="wide">電子ドラム・MIDI 機器設定</button><button id="midi-import" class="wide">MIDI ファイルを読み込む</button><label class="check-row"><input id="placement-preview" type="checkbox" ${placementPreview ? "checked" : ""}>配置時に試聴（BGM 除外）</label><label class="check-row"><input id="bgm-only" type="checkbox" ${bgmOnly ? "checked" : ""}>BGM だけを再生</label><div class="section-title">参照プレーヤー</div><div id="yt-host-wrap">${youtubeId ? '<button id="show-youtube" class="wide">YouTube プレーヤーを表示</button>' : '<span class="safety-note">原曲は上部の「＋ 音声」または「YouTube」から読み込みます。</span>'}</div><div class="note-box">キーボード入力: A S D F G H J K L。編集中のカーソル位置に配置します。録音モードでは再生位置をグリッドに合わせます。</div><label class="check-row"><input id="record" type="checkbox" ${recordMode ? "checked" : ""}>再生中のリアルタイム打ち込み</label>`;
  } else {
    box.innerHTML = `<div><div class="eyebrow">MUSICAL ARRANGEMENT</div><h2 style="font-size:16px;margin-top:7px">グルーヴを残して、易しく。</h2></div><div class="note-box">完成した譜面を原本に、難易度別の候補を作成。キック・バックビート・フレーズの要所を守り、採用前に必ず聴き比べます。</div><label class="stack">作成する難易度<select id="ai-level"><option value="easy">BASIC · 初級</option><option value="normal" selected>ADVANCED · 中級</option><option value="hard">EXTREME · 上級</option></select></label><button id="ai-generate" class="primary wide">✦ AI で難易度案を生成</button><button id="ai-multi" class="wide">3 難易度をまとめて生成</button><button id="local-generate" class="wide">通信せず規則で候補を作る</button><div class="safety-note">AI へ送信するのは匿名化したチップ ID・位置・レーン・拍情報。音声ファイルと API キーはモデルへの本文に含めません。OpenRouter の API 利用料金が発生します。</div><div id="ai-result">${aiProposal ? `<div class="inspector-card"><div class="row"><b>${esc(aiProposal.title)}</b><span class="chip">${aiProposal.keepIds.length} / ${project.notes.length}</span></div><div class="ai-preview" style="margin-top:10px">${esc(aiProposal.rationale)}<br>${aiProposal.warnings.map(esc).join("<br>")}</div><button id="ai-audition" class="wide" style="margin-top:10px">候補を試聴</button><button id="ai-adopt" class="primary wide" style="margin-top:6px">別の譜面として保存</button><button id="ai-discard" class="ghost wide">破棄して原本へ</button></div>` : '<div class="empty">まだ候補はありません</div>'}</div><hr class="separator"><div class="section-title">曲情報を調べる</div><button id="ai-metadata" class="wide">曲名・アーティスト・出典を調べる</button><div class="safety-note">曲名・アーティスト・参照 URL を送信。検索には追加料金が発生する場合があります。情報と画像は出典を確認してから採用します。</div><button id="ai-settings" class="ghost wide">OpenRouter の設定 →</button>`;
  }
}
let recordMode = false;
function modal(
  title: string,
  body: string,
  buttons: {
    label: string;
    action: () => void | Promise<void>;
    primary?: boolean;
  }[] = [],
) {
  $("modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button id="modal-close" class="ghost" aria-label="閉じる">×</button></header><div class="modal-content">${body}</div><footer>${buttons.map((b, i) => `<button data-modal-button="${i}" class="${b.primary ? "primary" : ""}">${esc(b.label)}</button>`).join("")}<button id="modal-cancel">閉じる</button></footer></section></div>`;
  $("modal-close").onclick = closeModal;
  $("modal-cancel").onclick = closeModal;
  $("modal-root")
    .querySelectorAll<HTMLButtonElement>("[data-modal-button]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          Promise.resolve(
            buttons[Number(b.dataset.modalButton)].action(),
          ).catch(handleError)),
    );
  (
    $("modal-root").querySelector("input,button,textarea") as HTMLElement
  )?.focus();
}
function closeModal() {
  libraryUI.dialogClosed();
  midiUI.dialogClosed();
  aiController?.abort();
  mediaPreview?.dispose();
  mediaPreview = undefined;
  $("modal-root").innerHTML = "";
}
function value(id: string) {
  return $<HTMLInputElement>(id).value;
}
function metadataDialog() {
  const meta = project.metadata;
  const raw = (key: string) =>
    project.passthrough
      .find((l) => new RegExp(`^#${key}\\s*[: ]`, "i").test(l))
      ?.replace(new RegExp(`^#${key}\\s*:?\\s*`, "i"), "") || "";
  modal(
    "曲情報",
    `<div class="field-grid"><label class="stack">曲名<input id="m-title" value="${esc(meta.title)}"></label><label class="stack">アーティスト<input id="m-artist" value="${esc(meta.artist)}"></label><label class="stack">ジャンル<input id="m-genre" value="${esc(raw("GENRE"))}"></label><label class="stack">作成者<input id="m-maker" value="${esc(raw("MAKER"))}"></label><label class="stack">ドラム難易度 (整数 0–1000)<input id="m-level" type="number" min="0" max="1000" value="${esc(raw("DLEVEL") || "50")}"></label><label class="stack">ギター難易度<input id="m-glevel" type="number" min="0" max="1000" value="${esc(raw("GLEVEL") || "0")}"></label><label class="stack">ベース難易度<input id="m-blevel" type="number" min="0" max="1000" value="${esc(raw("BLEVEL") || "0")}"></label><label class="stack">初期 BPM<input id="m-bpm" type="number" min="1" step=".01" value="${meta.bpm}"></label><label class="stack">試聴音源 (PREVIEW)<input id="m-preview" value="${esc(meta.preview)}"></label><label class="stack">背景画像 (BACKGROUND)<input id="m-background" value="${esc(meta.background)}"></label><label class="stack">選曲画像 (PREIMAGE)<input id="m-image" value="${esc(raw("PREIMAGE"))}"></label><label class="stack">パネル表示 (PANEL)<input id="m-panel" value="${esc(raw("PANEL"))}"></label><label class="stack">読み込み画像 (STAGEFILE)<input id="m-stage" value="${esc(raw("STAGEFILE"))}"></label><label class="stack">結果画像 (RESULTIMAGE)<input id="m-result" value="${esc(raw("RESULTIMAGE"))}"></label><label class="stack">BASEBPM<input id="m-base" type="number" min="0" value="${meta.baseBpm}"></label></div><label class="stack">コメント<textarea id="m-comment" rows="3">${esc(meta.comment)}</textarea></label><div class="note-box">難易度は NX の整数表現です。550 は 5.50 を表します。画像や音源のパスはプロジェクト内ファイル名を指定します。詳細なヘッダーは DTX テキストから編集できます。</div>`,
    [
      {
        label: "曲情報を保存",
        primary: true,
        action: () => {
          if (!checkpoint()) return;
          const bpm = Number(value("m-bpm")),
            base = Number(value("m-base")),
            level = Number(value("m-level"));
          if (
            [level, Number(value("m-glevel")), Number(value("m-blevel"))].some(
              (l) => !Number.isInteger(l) || l < 0 || l > 1000,
            )
          )
            throw new Error("難易度は 0–1000 の整数です");
          if (!(bpm > 0) || !Number.isFinite(base))
            throw new Error("BPM を確認してください");
          project.metadata = {
            ...meta,
            title: value("m-title"),
            artist: value("m-artist"),
            comment: value("m-comment"),
            preview: value("m-preview"),
            background: value("m-background"),
            bpm,
            baseBpm: base,
          };
          for (const [k, id] of [
            ["GENRE", "m-genre"],
            ["MAKER", "m-maker"],
            ["DLEVEL", "m-level"],
            ["PREIMAGE", "m-image"],
            ["GLEVEL", "m-glevel"],
            ["BLEVEL", "m-blevel"],
            ["PANEL", "m-panel"],
            ["STAGEFILE", "m-stage"],
            ["RESULTIMAGE", "m-result"],
          ])
            setDirective(k, value(id));
          closeModal();
          changed();
        },
      },
    ],
  );
}
function setDirective(key: string, val: string) {
  project.passthrough = project.passthrough.filter(
    (l) => !new RegExp(`^#${key}(?:\\s|:)`, "i").test(l),
  );
  if (val) project.passthrough.push(`#${key}: ${val.replace(/[\r\n]/g, " ")}`);
}
function sourceDialog() {
  modal(
    "DTX テキスト / 追加命令",
    `<div class="note-box warning">すべてのチャンネルと追加命令を編集できます。適用時に再解析します。RANDOM / IF・再定義があるファイルは安全のため視覚編集が読み取り専用になります。元データをバックアップしてください。</div><textarea id="dtx-source" class="code" spellcheck="false">${esc(project.readOnlyReason && project.originalText ? project.originalText : serializeDTX(project))}</textarea>`,
    [
      {
        label: "再解析して適用",
        primary: true,
        action: async () => {
          const { parseChart } = await import("./io");
          const next = parseChart(
            value("dtx-source"),
            `chart.${project.readOnlyReason ? project.metadata.sourceFormat || "dtx" : "dtx"}`,
          );
          undoStack.push(historySnapshot());
          redoStack = [];
          project = next;
          selection.clear();
          closeModal();
          changed();
        },
      },
    ],
  );
}
function resourceDialog(add = false) {
  const r = bankResources().find((r) => r.id === resourceId);
  const id = add ? nextResourceId(selectedBank) : r?.id || resourceId;
  const appearance = add
    ? { label: "", foreground: "", background: "", bgm: false }
    : getResourceAppearance(project, selectedBank as CreatorBank, id);
  modal(
    `${selectedBank} リソース${add ? "の追加" : "の編集"}`,
    `<div class="field-grid"><label class="stack">ID (01–ZZ)<input id="r-id" maxlength="2" value="${esc(id)}" ${add ? "" : "readonly"}></label><label class="stack">ファイル<input id="r-file" list="asset-paths" value="${esc(add ? "" : r?.file || "")}"></label></div><div class="field-grid"><label class="stack">ラベル<input id="r-label" value="${esc(appearance.label)}"></label><label class="stack">文字・チップ色<input id="r-fore" placeholder="#A4EF77" value="${esc(appearance.foreground)}"></label><label class="stack">リスト背景色<input id="r-back" placeholder="色名 / #RRGGBB" value="${esc(appearance.background)}"></label>${selectedBank === "WAV" ? `<label class="check-row"><input id="r-bgm" type="checkbox" ${appearance.bgm ? "checked" : ""}>BGM 音源として扱う</label>` : ""}</div><datalist id="asset-paths">${files.map((f) => `<option value="${esc(f.path)}">`).join("")}</datalist>${selectedBank === "WAV" ? `<div class="field-grid"><label class="stack">音量 (%)<input id="r-volume" type="number" min="0" max="100" value="${add ? 100 : (project.resources[id]?.volume ?? 100)}"></label><label class="stack">パン (-100 左 / 100 右)<input id="r-pan" type="number" min="-100" max="100" value="${add ? 0 : (project.resources[id]?.pan ?? 0)}"></label><label class="stack">チップサイズ (%)<input id="r-size" type="number" min="1" max="200" value="${add ? 100 : (project.resources[id]?.size ?? 100)}"></label></div>` : ""}<div class="note-box">ファイルを削除せず、定義だけを管理します。既存譜面の素材の権利は引き継がれません。公開・配布する際は許諾を確認してください。</div>`,
    [
      {
        label: "保存",
        primary: true,
        action: async () => {
          const id = value("r-id").toUpperCase();
          if (!/^[0-9A-Z]{2}$/.test(id) || id === "00")
            throw new Error("ID は 01–ZZ の 2 文字です");
          if (add && bankResources().some((x) => x.id === id))
            throw new Error("この ID は使用中です");
          const path = value("r-file");
          if (path) safeAssetPath(path);
          if (selectedBank === "WAV") {
            for (const [key, min, max] of [
              ["r-volume", 0, 100],
              ["r-pan", -100, 100],
              ["r-size", 1, 200],
            ] as const) {
              const n = Number(value(key));
              if (!Number.isFinite(n) || n < min || n > max)
                throw new Error("音量・パン・サイズの範囲を確認してください");
            }
          }
          let next = structuredClone(project);
          if (selectedBank === "WAV")
            next.resources[id] = {
              id,
              file: value("r-file"),
              volume: Math.min(100, Math.max(0, Number(value("r-volume")))),
              pan: Math.min(100, Math.max(-100, Number(value("r-pan")))),
              size: Math.min(200, Math.max(1, Number(value("r-size")))),
            };
          else {
            const key = selectedBank + id;
            next.passthrough = next.passthrough.filter(
              (l) => !new RegExp(`^#${key}(?:\\s|:)`, "i").test(l),
            );
            next.passthrough.push(`#${key}: ${path}`);
          }
          next = setResourceAppearance(next, selectedBank as CreatorBank, id, {
            label: value("r-label"),
            foreground: value("r-fore"),
            background: value("r-back"),
            ...(selectedBank === "WAV"
              ? { bgm: ($("r-bgm") as HTMLInputElement).checked }
              : {}),
          });
          if (!checkpoint()) return;
          project = next;
          resourceId = id;
          closeModal();
          await syncSamples();
          changed();
        },
      },
      {
        label: "定義を削除",
        action: () => {
          if (!r || !checkpoint()) return;
          if (project.notes.some((n) => n.value === id)) {
            if (
              !confirm(
                "この ID を参照するチップがあります。定義を削除すると素材未定義になります。削除しますか？",
              )
            )
              return;
          }
          if (selectedBank === "WAV") delete project.resources[id];
          else setDirective(selectedBank + id, "");
          closeModal();
          changed();
        },
      },
    ],
  );
}
function nextResourceId(bank = "WAV") {
  const ids =
    bank === "WAV"
      ? Object.keys(project.resources)
      : bankResources().map((r) => r.id);
  for (let i = 1; i < 1296; i++) {
    const id = i.toString(36).toUpperCase().padStart(2, "0");
    if (!ids.includes(id)) return id;
  }
  throw new Error("ID が不足しています");
}
async function saveProject(quiet = false) {
  const id = projectId || uid();
  projectId = id;
  const rev = revision;
  const snapshot = {
    project: structuredClone(project),
    chartPath: sourceChartPath,
    referencePath,
    youtubeId,
    referenceBgmId,
    referenceOffset: transport.referenceOffset,
    loopStart,
    loopEnd,
  };
  const snapshotFiles = files.slice();
  const name = title();
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      try {
        await store.save({ id, name, data: snapshot, files: snapshotFiles });
        if (projectId === id && revision === rev) {
          dirty = false;
          localStorage.setItem("dtx-studio-last", id);
          $("save-state").textContent =
            `保存済み ${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;
          $("project-title").innerHTML =
            `${esc(title())}<small>${esc(project.metadata.artist)} · ローカル保存済み</small>`;
        }
        if (!quiet) toast("このブラウザにプロジェクトと音源を保存しました");
      } catch (e) {
        $("save-state").textContent = "保存失敗 · ZIP バックアップを推奨";
        handleError(e);
      }
    });
  await saveQueue;
}
async function openDialog() {
  const entries = (await store.list()).filter(
    (e) => !e.name.startsWith("[音源ライブラリ] "),
  );
  modal(
    "プロジェクトを開く",
    `<div class="row"><button id="open-files-modal" class="primary grow">DTX / ZIP / プロジェクトを読み込む</button><button id="open-folder-modal" class="grow">曲フォルダを開く</button></div><div class="note-box">DTX は CP932 / UTF-8 に対応。音源と一緒に曲フォルダまたは ZIP を読み込むとパスを解決します。ファイルはアップロードされません。</div><div class="section-title">このブラウザに保存したプロジェクト</div><div>${entries.map((e) => `<div class="row" style="padding:10px 0;border-bottom:1px solid #344055"><div class="grow"><b>${esc(e.name)}</b><div class="small muted">${new Date(e.updatedAt).toLocaleString("ja-JP")} · ${e.fileCount} ファイル</div></div><button data-load="${esc(e.id)}">開く</button><button data-delete-project="${esc(e.id)}" class="ghost danger">削除</button></div>`).join("") || '<div class="empty">保存したプロジェクトはまだありません</div>'}</div>`,
  );
  $("open-files-modal").onclick = () => chooseFiles("chart");
  $("open-folder-modal").onclick = () => chooseFolder(false);
  $("modal-root")
    .querySelectorAll<HTMLButtonElement>("[data-load]")
    .forEach(
      (b) =>
        (b.onclick = async () => {
          if (dirty && !confirm("現在の変更を保存せず切り替えますか？")) return;
          const s = await store.load<{
            project: Project;
            referencePath?: string;
            youtubeId?: string;
          }>(b.dataset.load!);
          if (!s) return;
          referenceGeneration++;
          await transport.setReferenceAudio(null);
          transport.detachYouTube();
          waveform = null;
          referenceDuration = 0;
          sourceChartPath = String(
            (s.data as { chartPath?: string }).chartPath || "",
          );
          files = s.files;
          projectId = s.id;
          referencePath = s.data.referencePath || "";
          referenceBgmId = String(
            (s.data as { referenceBgmId?: string }).referenceBgmId || "",
          );
          youtubeId = "";
          setProject(
            validateProjectManifest({ version: 1, ...s.data }).project,
          );
          transport.setReferenceOffset(
            Number((s.data as { referenceOffset?: number }).referenceOffset) ||
              0,
          );
          referenceBgmId = String(
            (s.data as { referenceBgmId?: string }).referenceBgmId || "",
          );
          if (referencePath) {
            const f = findFile(referencePath);
            if (f) await loadReference(f.blob, f.path);
          }
          closeModal();
        }),
    );
  $("modal-root")
    .querySelectorAll<HTMLButtonElement>("[data-delete-project]")
    .forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            confirm(
              "このブラウザに保存したプロジェクトと専用コピーの素材を削除しますか？",
            )
          ) {
            await store.delete(b.dataset.deleteProject!);
            if (projectId === b.dataset.deleteProject) projectId = undefined;
            await openDialog();
          }
        }),
    );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportDialog() {
  const missing = Object.values(project.resources).filter(
    (r) => r.file && !findFile(r.file),
  );
  modal(
    "書き出し",
    `<div class="note-box">原曲や取り込んだ音源も ZIP に含められます。配布前に、音源・画像・動画の権利を確認してください。API キーは書き出しに含みません。</div>${missing.length ? `<div class="note-box warning">${missing.length} 個の音源ファイルが未読込です: ${missing.map((x) => esc(x.file)).join(", ")}。DTX だけを書き出すか、元の音源を読み込んでください。</div>` : ""}<label class="stack">DTX の文字コード<select id="export-encoding"><option value="sjis">CP932 / Shift_JIS（NX 推奨）</option><option value="utf8">UTF-8（日本語表示はゲーム側依存）</option></select></label><div class="safety-note">プロジェクト ZIP は編集情報・全素材を保持します。DTX パッケージにはゲーム用の譜面と素材を格納します。</div>`,
    [
      {
        label: "DTX のみ",
        action: async () => {
          download(
            new Blob([
              await encodeDTX(serializeDTX(project), value("export-encoding")),
            ]),
            safeName(title()) + ".dtx",
          );
        },
      },
      {
        label: "MIDI",
        action: async () => {
          const { serializeMIDI } = await import("./midi");
          download(
            new Blob([serializeMIDI(project)]),
            safeName(title()) + ".mid",
          );
        },
      },
      { label: "プロジェクト ZIP", action: () => exportZIP(true) },
      {
        label: "DTX + 素材 ZIP",
        primary: true,
        action: () => exportZIP(false),
      },
    ],
  );
}
async function encodeDTX(text: string, encoding: string) {
  if (encoding === "utf8") return new TextEncoder().encode(text);
  const { encodeCP932 } = await import("./encoding");
  return encodeCP932(text);
}
function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "chart";
}
async function exportZIP(full: boolean) {
  const entries: Record<string, Uint8Array> = {};
  if (full && project.readOnlyReason && project.originalText)
    entries["original-chart.txt"] = strToU8(project.originalText);
  else
    entries["chart.dtx"] = await encodeDTX(
      serializeDTX(project),
      value("export-encoding"),
    );
  for (const f of files) {
    const path = normalizePath(f.path);
    if (
      (path === "chart.dtx" && !(full && project.readOnlyReason)) ||
      path === "project.json"
    )
      continue;
    entries[path] = new Uint8Array(await f.blob.arrayBuffer());
  }
  if (full)
    entries["project.json"] = strToU8(
      JSON.stringify(
        {
          version: 1,
          project,
          chartPath: sourceChartPath,
          referencePath,
          youtubeId,
          referenceOffset: transport.referenceOffset,
          referenceBgmId,
          loopStart,
          loopEnd,
        },
        null,
        2,
      ),
    );
  entries["README.txt"] = strToU8(
    "DTX Studio export. Bundled FluidR3Mono MIDI kit is MIT licensed; keep kit/fluidr3/LICENSE.txt and SOURCES.json. Fallback procedural sounds are CC0. Imported assets retain their original rights. API keys are never included.\n",
  );
  download(
    new Blob([zipSync(entries, { level: 6 })]),
    safeName(title()) + (full ? ".project.zip" : ".dtx.zip"),
  );
  toast("ZIP を書き出しました");
}
let inputPurpose = "chart",
  folderAudioOnly = false;
function chooseFiles(purpose: string) {
  inputPurpose = purpose;
  const input = $<HTMLInputElement>("file-input");
  input.accept =
    purpose === "audio"
      ? "audio/*,.wav,.ogg,.mp3,.flac,.xa"
      : purpose === "midi"
        ? ".mid,.midi"
        : purpose === "media"
          ? "image/*,video/*,.avi"
          : ".dtx,.gda,.g2d,.bms,.bme,.zip,.json";
  input.value = "";
  input.click();
}
function chooseFolder(audioOnly: boolean) {
  folderAudioOnly = audioOnly;
  const input = $<HTMLInputElement>("folder-input");
  input.value = "";
  input.click();
}
async function readDTX(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}
async function processFiles(input: File[], purpose = "chart", folder = false) {
  if (!input.length) return;
  if (purpose === "midi") {
    const { parseMIDI } = await import("./midi");
    if (dirty && !confirm("現在の譜面を置き換えますか？")) return;
    const p = parseMIDI(new Uint8Array(await input[0].arrayBuffer()));
    files = [];
    projectId = undefined;
    setProject(p);
    await installKit();
    changed();
    closeModal();
    return;
  }
  if (
    purpose === "chart" &&
    input.length === 1 &&
    /\.zip$/i.test(input[0].name)
  ) {
    if (input[0].size > 150 * 1024 * 1024)
      throw new Error("ZIP は 150 MB 以下に分割してください");
    const archive = safeUnzip(new Uint8Array(await input[0].arrayBuffer()));
    let total = 0;
    const extracted: ImportedFile[] = [];
    for (const [path, bytes] of Object.entries(archive)) {
      if (path.endsWith("/")) continue;
      total += bytes.length;
      if (total > 500 * 1024 * 1024)
        throw new Error("展開サイズが 500 MB を超えています");
      const safe = normalizePath(path),
        blob = new Blob([new Uint8Array(bytes)]);
      extracted.push({
        path: safe,
        name: safe.split("/").at(-1)!,
        blob,
        hash: await hashBlob(blob),
        size: blob.size,
        type: blob.type,
      });
    }
    await applyImported(extracted, false);
    closeModal();
    return;
  }
  if (purpose === "media") {
    const result = await importFiles(input, files);
    files.push(...result.files);
    if (checkpoint()) {
      for (const f of result.files) {
        const bank = /\.(mp4|webm|avi|mov)$/i.test(f.path) ? "AVI" : "BMP";
        const oldBank = selectedBank;
        selectedBank = bank;
        const id = nextResourceId(bank);
        selectedBank = oldBank;
        setDirective(bank + id, f.path);
      }
      changed();
      closeModal();
    }
    return;
  }
  const audioOnly = purpose === "audio";
  const selected = audioOnly
    ? input.filter((f) => /\.(wav|ogg|mp3|flac|m4a|aac|xa)$/i.test(f.name))
    : input;
  const result = await importFiles(selected, audioOnly ? files : []);
  if (result.ambiguousPaths.length)
    throw new Error(
      "同名ファイルに異なる内容があります。曲ごとにフォルダを分けてください: " +
        result.ambiguousPaths.join(", "),
    );
  if (result.warnings.length) toast(result.warnings.join("\n"), true);
  await applyImported(result.files, audioOnly);
  closeModal();
}
async function applyImported(imported: ImportedFile[], audioOnly: boolean) {
  if (audioOnly) {
    if (!checkpoint()) return;
    files.push(...imported);
    for (const f of imported) {
      const id = nextResourceId();
      project.resources[id] = { id, file: f.path, volume: 100 };
    }
    await syncSamples();
    changed();
    toast(`${imported.length} 音源をライブラリに追加しました`);
    return;
  }
  if (dirty && !confirm("現在の変更を保存せず開きますか？")) return;
  const manifest =
    imported.find((f) => f.path === "project.json") ||
    (imported.length === 1 && /\.json$/i.test(imported[0].path)
      ? imported[0]
      : undefined);
  if (manifest) {
    const p = validateProjectManifest(JSON.parse(await manifest.blob.text()));
    if (
      p.version !== 1 ||
      !p.project?.metadata ||
      !Array.isArray(p.project.notes)
    )
      throw new Error("未対応のプロジェクト形式です");
    if (!p.project.readOnlyReason) serializeDTX(p.project);
    referenceGeneration++;
    await transport.setReferenceAudio(null);
    transport.detachYouTube();
    waveform = null;
    referenceDuration = 0;
    files = imported.filter((f) => f !== manifest && !/\.dtx$/i.test(f.path));
    projectId = undefined;
    referencePath = p.referencePath || "";
    youtubeId = "";
    sourceChartPath = (p as typeof p & { chartPath?: string }).chartPath || "";
    setProject(p.project);
    transport.setReferenceOffset(p.referenceOffset || 0);
    referenceBgmId = p.referenceBgmId || "";
    if (referencePath) {
      const f = findFile(referencePath);
      if (f) await loadReference(f.blob, f.path);
    }
    await saveProject(true);
    toast("プロジェクトを復元しました");
    return;
  }
  const charts = imported.filter((f) =>
    /\.(dtx|gda|g2d|bms|bme)$/i.test(f.path),
  );
  if (!charts.length)
    throw new Error(
      "DTX がありません。音源だけの取込は「フォルダから抽出」を使ってください。",
    );
  const load = async (chart: ImportedFile) => {
    const { parseChartBytes } = await import("./io");
    const parsed = parseChartBytes(
      new Uint8Array(await chart.blob.arrayBuffer()),
      chart.path,
    );
    const rebased = rebaseImportedChart(parsed, chart.path);
    const p = validateProjectManifest(
      { version: 1, project: rebased },
      { chartPath: parsed.readOnlyReason ? chart.path : undefined },
    ).project;
    sourceChartPath = parsed.readOnlyReason ? chart.path : "";
    files = imported.slice();
    projectId = undefined;
    referencePath = "";
    youtubeId = "";
    transport.setReferenceAudio(null);
    setProject(p);
    await saveProject(true);
    closeModal();
    toast(`${chart.name} を読み込みました`);
  };
  if (charts.length === 1) await load(charts[0]);
  else
    modal(
      "読み込む譜面を選ぶ",
      charts
        .map(
          (c, i) => `<button data-chart-choice="${i}">${esc(c.path)}</button>`,
        )
        .join(""),
    );
  $("modal-root")
    .querySelectorAll<HTMLButtonElement>("[data-chart-choice]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          load(charts[Number(b.dataset.chartChoice)]).catch(handleError)),
    );
}
async function installKit() {
  defaultLaneSounds = {};
  for (const [i, lane] of LANES.entries())
    defaultLaneSounds[lane.id] = (i + 1)
      .toString(36)
      .toUpperCase()
      .padStart(2, "0");
  const generated: ImportedFile[] = [];
  for (const r of Object.values(project.resources)) {
    const lane =
      project.notes.find((n) => n.value === r.id)?.lane ||
      LANES.find(
        (_, i) => (i + 1).toString(36).toUpperCase().padStart(2, "0") === r.id,
      )?.id ||
      "HH";
    const blob = synthesizeKitWav(aliases[lane] || lane);
    generated.push({
      path: r.file,
      name: r.file,
      blob,
      hash: await hashBlob(blob),
      size: blob.size,
      type: "audio/wav",
    });
  }
  files = generated;
  await syncSamples();
}
let referenceGeneration = 0;
async function loadReference(blob: Blob, name: string) {
  const generation = ++referenceGeneration;
  transport.pause();
  await transport.setReferenceAudio(blob);
  if (generation !== referenceGeneration) return;
  youtubeId = "";
  referencePath = name;
  $("reference-name").textContent = name;
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (generation !== referenceGeneration) return;
    referenceDuration = buffer.duration;
    const data = buffer.getChannelData(0);
    waveform = new Float32Array(1200);
    const stride = Math.max(1, Math.floor(data.length / 1200));
    for (let i = 0; i < 1200; i++) {
      let peak = 0;
      for (
        let j = i * stride;
        j < Math.min((i + 1) * stride, data.length);
        j += Math.max(1, Math.floor(stride / 100))
      )
        peak = Math.max(peak, Math.abs(data[j]));
      waveform[i] = peak;
    }
  } finally {
    await context.close();
  }
  drawWaveform();
  renderInspector();
}
let taps: number[] = [];
function tapBPM() {
  const now = performance.now();
  if (now - (taps.at(-1) || 0) > 2500) taps = [];
  taps.push(now);
  if (taps.length > 8) taps.shift();
  if (taps.length < 3) {
    toast(`TAP ${taps.length} · 同じ間隔で続けてください`);
    return;
  }
  const spans = taps
    .slice(1)
    .map((t, i) => t - taps[i])
    .sort((a, b) => a - b);
  const bpm =
    Math.round((60000 / spans[Math.floor(spans.length / 2)]) * 10) / 10;
  if (bpm < 20 || bpm > 400) return;
  if (checkpoint()) {
    project.metadata.bpm = bpm;
    changed();
    toast(`TAP 推定 ${bpm} BPM · 原曲と聴き比べて確認`);
  }
}
function settingsDialog() {
  modal(
    "設定 / OpenRouter",
    `<div class="note-box warning">API キーをこのブラウザに保存すると、同じサイトで動く JavaScript から参照できます。共有端末では保存しないでください。キーは OpenRouter への認証にだけ使用し、ZIP・DTX・GitHub に含めません。</div><label class="stack">OpenRouter API キー<input id="settings-key" type="password" autocomplete="off" placeholder="sk-or-…" value="${esc(sessionKey || localStorage.getItem("dtx-studio-key") || "")}"></label><label class="check-row"><input id="remember-key" type="checkbox" ${localStorage.getItem("dtx-studio-key") ? "checked" : ""}>このブラウザにキーを保存する</label><label class="stack">モデル ID<input id="settings-model" value="${esc(localStorage.getItem("dtx-studio-model") || "openai/gpt-4.1-mini")}"></label><div class="safety-note">実行のたびに OpenRouter にデータを送信し、モデルに応じた料金がかかります。モデル ID は OpenRouter の提供状況に合わせて変更できます。キーを削除しても利用済み料金は取り消されません。</div><hr class="separator"><div class="section-title">ローカルデータ</div><div class="safety-note">プロジェクトは IndexedDB に保存。ブラウザのサイトデータ削除・容量不足で失われることがあるため、ZIP のバックアップを推奨します。</div>`,
    [
      {
        label: "キーを削除",
        action: () => {
          localStorage.removeItem("dtx-studio-key");
          sessionKey = "";
          ($("settings-key") as HTMLInputElement).value = "";
          toast("保存済みキーを削除しました");
        },
      },
      {
        label: "設定を保存",
        primary: true,
        action: () => {
          sessionKey = value("settings-key").trim();
          if (($("remember-key") as HTMLInputElement).checked)
            localStorage.setItem("dtx-studio-key", sessionKey);
          else localStorage.removeItem("dtx-studio-key");
          localStorage.setItem(
            "dtx-studio-model",
            value("settings-model").trim(),
          );
          closeModal();
          toast("設定を保存しました");
        },
      },
    ],
  );
}
let sessionKey = "";
function getKey() {
  return sessionKey || localStorage.getItem("dtx-studio-key") || "";
}
function getModel() {
  return localStorage.getItem("dtx-studio-model") || "openai/gpt-4.1-mini";
}
async function generateAI(local = false) {
  if (project.readOnlyReason) throw new Error(project.readOnlyReason);
  const level = value("ai-level") as "easy" | "normal" | "hard";
  if (local) {
    aiProposal = simplifyMusically(project.notes, level, {
      bpm: project.metadata.bpm,
      tempos: project.tempos,
      measures: Array.from({ length: project.barCount }, (_, bar) => ({
        startBeat: barStartBeat(project, bar),
        length: 4 * barLengthAt(project, bar),
      })),
    });
    renderInspector();
    drawChart();
    return;
  }
  if (!getKey()) {
    settingsDialog();
    return;
  }
  if (
    !confirm(
      `OpenRouter に ${project.notes.length} チップの ID・拍位置・チャンネルとテンポ情報を送信し、${getModel()} で候補を生成します。API 料金が発生します。実行しますか？`,
    )
  )
    return;
  aiController?.abort();
  aiController = new AbortController();
  const baseline = JSON.stringify(project);
  $("ai-result").innerHTML =
    '<div class="note-box">候補を生成しています…<button id="cancel-ai" class="wide">中止</button></div>';
  $("cancel-ai").onclick = () => aiController?.abort();
  try {
    const proposal = await requestDifficulty(
      getKey(),
      getModel(),
      project.notes,
      level,
      aiController.signal,
      {
        bpm: project.metadata.bpm,
        tempos: project.tempos,
        measures: Array.from({ length: project.barCount }, (_, bar) => ({
          startBeat: barStartBeat(project, bar),
          length: barLengthAt(project, bar) * 4,
        })),
      },
    );
    if (JSON.stringify(project) !== baseline)
      throw new Error(
        "生成中に元譜面が変更されました。古い候補は破棄しました。",
      );
    aiProposal = proposal;
    renderInspector();
    drawChart();
  } catch (e) {
    renderInspector();
    if (e instanceof DOMException && e.name === "AbortError")
      toast("AI 生成を中止しました");
    else throw e;
  }
}
async function metadataAI() {
  if (!getKey()) {
    settingsDialog();
    return;
  }
  if (
    !confirm(
      "曲名・アーティスト・YouTube URL を OpenRouter に送り、出典付きで曲情報を調べます。検索とモデルの API 料金が発生する場合があります。実行しますか？",
    )
  )
    return;
  aiController = new AbortController();
  const baseline = JSON.stringify(project);
  modal(
    "曲情報を調べています",
    `<div class="note-box">出典付き候補を取得しています。音源は送信しません。</div>`,
    [
      {
        label: "中止",
        action: () => {
          aiController?.abort();
          closeModal();
        },
      },
    ],
  );
  try {
    const result = await requestMetadata(
      getKey(),
      getModel(),
      String(project.metadata.title),
      String(project.metadata.artist),
      youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : "",
      aiController.signal,
    );
    if (JSON.stringify(project) !== baseline || aiController.signal.aborted)
      throw new Error("曲が変更されたため、古い候補を破棄しました");
    modal(
      "曲情報の候補 · 採用前に確認",
      `<div class="field-grid"><label class="stack">曲名<input id="ai-meta-title" value="${esc(result.title || "")}"></label><label class="stack">アーティスト<input id="ai-meta-artist" value="${esc(result.artist || "")}"></label></div><label class="stack">コメント<textarea id="ai-meta-comment">${esc(result.comment || "")}</textarea></label><div class="section-title">出典</div><div class="safety-note">${
        (result.sourceUrls || [])
          .filter((u: string) => /^https:\/\//.test(u))
          .map(
            (u: string) =>
              `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`,
          )
          .join("<br>") || "検証できる出典なし。推測として扱ってください。"
      }</div><div class="note-box warning">${(result.warnings || []).map(esc).join("<br>") || "同名曲や表記の違いに注意。画像は権利を確認して手動で取り込んでください。"}</div>${result.thumbnailUrl ? `<a href="${esc(result.thumbnailUrl)}" target="_blank" rel="noopener noreferrer">候補画像の出典を開く（自動保存しません）</a>` : ""}`,
      [
        {
          label: "曲情報として採用",
          primary: true,
          action: () => {
            if (JSON.stringify(project) !== baseline)
              throw new Error("元の曲が変更されています。取得し直してください");
            if (!checkpoint()) return;
            project.metadata.title = value("ai-meta-title");
            project.metadata.artist = value("ai-meta-artist");
            project.metadata.comment = value("ai-meta-comment");
            closeModal();
            changed();
          },
        },
      ],
    );
  } catch (e) {
    closeModal();
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
}
async function adoptProposal() {
  if (!aiProposal) return;
  const candidate = structuredClone(project);
  const keep = new Set(aiProposal.keepIds);
  candidate.notes = candidate.notes.filter((n) => keep.has(n.id));
  candidate.metadata.title = title() + " [" + aiProposal.title + "]";
  candidate.metadata.comment =
    String(candidate.metadata.comment || "") + "\n" + aiProposal.rationale;
  delete candidate.originalFingerprint;
  delete candidate.originalText;
  const saved = await store.save({
    name: candidate.metadata.title,
    data: {
      project: candidate,
      referencePath,
      youtubeId,
      referenceOffset: transport.referenceOffset,
      referenceBgmId,
    },
    files,
  });
  modal(
    "別譜面として保存しました",
    `<div class="note-box">原本「${esc(title())}」はそのまま保持しています。候補「${esc(candidate.metadata.title)}」をこのブラウザに保存しました。</div>`,
    [
      {
        label: "候補を開いて編集",
        primary: true,
        action: () => {
          projectId = saved.id;
          setProject(candidate);
          closeModal();
        },
      },
    ],
  );
}
function youtubeDialog() {
  modal(
    "YouTube を参照する",
    `<label class="stack">動画 URL / 動画 ID<input id="youtube-url" placeholder="https://www.youtube.com/watch?v=…" value="${esc(youtubeId)}"></label><div class="note-box">公式プレーヤーでストリーミング再生します。動画はダウンロードしません。読み込み時に YouTube に接続します。埋め込み禁止・年齢制限・地域制限の動画は利用できません。</div><div class="note-box warning">共有シークはプレーヤー API の精度に依存します。細かい耳コピと正確な同期には、利用権のあるローカル音源を推奨します。</div>`,
    [
      {
        label: "プレーヤーを読み込む",
        primary: true,
        action: async () => {
          const raw = value("youtube-url").trim();
          let id = raw;
          if (raw.includes("://")) {
            const url = new URL(raw);
            id =
              url.hostname === "youtu.be"
                ? url.pathname.slice(1)
                : url.searchParams.get("v") ||
                  url.pathname.split("/").at(-1) ||
                  "";
          }
          if (!/^[\w-]{11}$/.test(id))
            throw new Error("YouTube の動画 ID を取得できません");
          transport.detachYouTube();
          $("youtube-dock")?.remove();
          youtubeId = id;
          referencePath = "";
          waveform = null;
          showYouTube();
          const host = $("youtube-player");
          await transport.attachYouTube(host, id);
          $("reference-name").textContent = "YouTube · " + id;
          renderInspector();
          drawWaveform();
        },
      },
    ],
  );
}
function showYouTube() {
  let dock = $("youtube-dock");
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "youtube-dock";
    dock.style.cssText =
      "position:fixed;right:18px;bottom:48px;width:300px;background:#111;border:1px solid #526176;z-index:60;border-radius:8px;overflow:hidden;box-shadow:0 8px 40px #0008";
    dock.innerHTML =
      '<div class="row" style="padding:5px 9px;font-size:10px">YouTube 参照<span class="spacer"></span><button id="youtube-dock-close" class="ghost" style="padding:2px 5px">解除 ×</button></div><div id="youtube-player" class="yt-box"></div>';
    document.body.append(dock);
    $("youtube-dock-close").onclick = () => {
      transport.detachYouTube();
      dock.remove();
      youtubeId = "";
      $("reference-name").textContent = "YouTube を解除しました";
    };
  }
  dock.style.display = "block";
  closeModal();
}
function editMenu() {
  modal(
    "選択の編集",
    `<div class="row wrap"><button id="edit-copy">コピー</button><button id="edit-cut">切り取り</button><button id="edit-paste">カーソルに貼り付け</button><button id="edit-all">表示レーンをすべて選択</button><button id="edit-lane">現在のレーンを選択</button><button id="edit-bar">現在の小節を選択</button><button id="edit-delete" class="danger">選択を削除</button><button id="edit-flip">表裏を反転</button><button id="edit-search">チップを検索</button></div><hr class="separator"><div class="field-grid"><label class="stack">移動量（拍）<input id="edit-shift" type="number" step=".25" value="1"></label><button id="edit-move">選択を移動</button><label class="stack">置換元 WAV ID<input id="replace-from" maxlength="2" value="${esc(resourceId)}"></label><label class="stack">置換先 WAV ID<input id="replace-to" maxlength="2" value="01"></label></div><label class="check-row"><input id="replace-selection" type="checkbox" ${selection.size ? "checked" : ""}>選択チップだけを置換</label><button id="replace-wav">音声チップの WAV を置換</button><div class="note-box">コピー・貼り付けは相対位置と各チップの音源を保持します。メディアの ID は WAV 置換に巻き込みません。</div>`,
  );
  $("edit-search").onclick = searchDialog;
  $("edit-lane").onclick = () => {
    selection = new Set(
      project.notes
        .filter((n) => noteLaneIndices(n).includes(cursorLane))
        .map((n) => n.id),
    );
    closeModal();
    render();
  };
  $("edit-bar").onclick = () => {
    const bar = beatToBar(project, cursorBeat).bar;
    selection = new Set(
      project.notes
        .filter(
          (n) =>
            n.beat >= barStartBeat(project, bar) &&
            n.beat < barStartBeat(project, bar + 1),
        )
        .map((n) => n.id),
    );
    closeModal();
    render();
  };
  $("edit-flip").onclick = () => {
    const next = structuredClone(project);
    for (const n of next.notes.filter((n) => selection.has(n.id))) {
      const lane = CREATOR_LANES.find(
        (l) =>
          l.front !== l.back && (l.front === n.channel || l.back === n.channel),
      );
      if (lane) {
        n.channel = n.channel === lane.front ? lane.back : lane.front;
        n.lane = channelToLane(n.channel);
      }
    }
    try {
      assertNoNewNoteCollisions(project.notes, next.notes);
    } catch (e) {
      handleError(e);
      return;
    }
    if (!checkpoint()) return;
    project = next;
    closeModal();
    changed();
  };
  $("edit-copy").onclick = () => {
    copyNotes();
    closeModal();
  };
  $("edit-cut").onclick = () => {
    copyNotes();
    deleteNotes();
    closeModal();
  };
  $("edit-paste").onclick = () => {
    pasteNotes();
    closeModal();
  };
  $("edit-all").onclick = () => {
    selection = new Set(
      project.notes.filter((n) => laneIndex(n) >= 0).map((n) => n.id),
    );
    closeModal();
    render();
  };
  $("edit-delete").onclick = () => {
    deleteNotes();
    closeModal();
  };
  $("edit-move").onclick = () => {
    moveNotes(Number(value("edit-shift")));
    closeModal();
  };
  $("replace-wav").onclick = async () => {
    const { replaceWavReferences } = await import("./edit");
    if (checkpoint()) {
      project = replaceWavReferences(
        project,
        value("replace-from").toUpperCase(),
        value("replace-to").toUpperCase(),
        ($("replace-selection") as HTMLInputElement).checked
          ? [...selection]
          : undefined,
      );
      closeModal();
      changed();
    }
  };
}
function copyNotes() {
  clipboard = project.notes
    .filter((n) => selection.has(n.id))
    .map((n) => ({ ...n }));
  toast(`${clipboard.length} チップをコピー`);
}
function pasteNotes() {
  if (!clipboard.length || !checkpoint()) return;
  const start = Math.min(...clipboard.map((n) => n.beat));
  const pasted = clipboard.map((n) => ({
    ...n,
    id: uid(),
    beat: n.beat - start + cursorBeat,
  }));
  try {
    assertNoNewNoteCollisions(project.notes, [...project.notes, ...pasted]);
  } catch (e) {
    undoStack.pop();
    handleError(e);
    return;
  }
  project.notes.push(...pasted);
  selection = new Set(pasted.map((n) => n.id));
  expandBars();
  changed();
}
function deleteNotes() {
  if (!selection.size || !checkpoint()) return;
  project.notes = project.notes.filter((n) => !selection.has(n.id));
  selection.clear();
  changed();
}
function moveNotes(delta: number) {
  if (!selection.size || !Number.isFinite(delta) || !checkpoint()) return;
  if (project.notes.some((n) => selection.has(n.id) && n.beat + delta < 0)) {
    undoStack.pop();
    throw new Error("先頭より前には移動できません");
  }
  const next = project.notes.map((n) =>
    selection.has(n.id) ? { ...n, beat: n.beat + delta } : n,
  );
  try {
    assertNoNewNoteCollisions(project.notes, next);
  } catch (e) {
    undoStack.pop();
    handleError(e);
    return;
  }
  project.notes = next;
  expandBars();
  changed();
}
function expandBars() {
  timelineCache = undefined;
  const max = Math.max(
    0,
    ...project.notes.map((n) => n.beat),
    ...project.tempos.map((t) => t.beat),
  );
  project.barCount = Math.max(
    project.barCount,
    beatToBar(project, max).bar + 1,
  );
}
async function barDialog() {
  const bar = Math.max(0, Number(value("bar-index")) - 1);
  modal(
    `小節 ${bar + 1} の編集`,
    `<div class="field-grid"><label class="stack">小節長（4/4 を 1 とする）<input id="bar-ratio" type="number" min=".0625" max="16" step=".25" value="${barLengthAt(project, bar)}"></label><label class="stack">挿入 / 削除する小節数<input id="bar-count" type="number" min="1" max="100" value="1"></label></div><label class="stack">チップ位置の扱い<select id="bar-mode"><option value="preserve">小節内の拍位置を保持（Creator 方式）</option><option value="stretch">小節比率に合わせて伸縮</option></select></label><div class="note-box">伸縮を選ぶと、この小節内のチップの相対位置を保ったまま伸縮し、後続の小節を移動します。挿入と削除は画像・動画・BPM チップもまとめて移動します。</div>`,
    [
      {
        label: "小節を挿入",
        action: async () => {
          const { insertMeasures } = await import("./edit");
          const count = Number(value("bar-count"));
          if (checkpoint()) {
            project = insertMeasures(project, bar, count);
            closeModal();
            changed();
          }
        },
      },
      {
        label: "小節を削除",
        action: async () => {
          if (!confirm("この小節範囲内の全チップを削除しますか？")) return;
          const { deleteMeasures } = await import("./edit");
          if (checkpoint()) {
            project = deleteMeasures(project, bar, Number(value("bar-count")));
            selection.clear();
            closeModal();
            changed();
          }
        },
      },
      {
        label: "長さを変更",
        primary: true,
        action: async () => {
          const { changeMeasureLength } = await import("./edit");
          if (checkpoint()) {
            project = changeMeasureLength(
              project,
              bar,
              Number(value("bar-ratio")),
              value("bar-mode") as "preserve" | "stretch",
            );
            closeModal();
            changed();
          }
        },
      },
    ],
  );
}
function addTempoDialog() {
  modal(
    "途中の BPM 変更",
    `<div class="field-grid"><label class="stack">位置（拍）<input id="tempo-beat" type="number" min="0" step=".25" value="${cursorBeat}"></label><label class="stack">BPM<input id="tempo-bpm" type="number" min="1" step=".01" value="${project.metadata.bpm}"></label></div>`,
    [
      {
        label: "追加",
        primary: true,
        action: () => {
          const beat = Number(value("tempo-beat")),
            bpm = Number(value("tempo-bpm"));
          if (
            !Number.isFinite(beat) ||
            beat < 0 ||
            !Number.isFinite(bpm) ||
            bpm <= project.metadata.baseBpm
          )
            throw new Error("BPM / 位置を確認してください");
          if (checkpoint()) {
            project.tempos.push({
              id: uid(),
              beat,
              bpm,
              channel: "08",
              value: "01",
            });
            project.tempos.sort((a, b) => a.beat - b.beat);
            closeModal();
            changed();
          }
        },
      },
    ],
  );
}
function channelsDialog() {
  modal(
    "チャンネルを直接編集",
    `<label class="stack">表示するチャンネル（カンマ区切り、最大 16）<input id="custom-channels" value="${esc(customChannels.join(","))}"></label><div class="note-box">DTX のすべての 2 桁チャンネルを配置・選択・移動・削除できます。チップ値は左の選択 ID を使います。BPM は専用の「BPM ＋」から追加してください。ギター・ベースのフレット組合せもチャンネルとして保持します。</div>`,
    [
      {
        label: "レーンへ適用",
        primary: true,
        action: () => {
          const channels = value("custom-channels")
            .toUpperCase()
            .split(/[,\s]+/)
            .filter(Boolean);
          if (
            !channels.length ||
            channels.length > 16 ||
            channels.some((c) => !/^[0-9A-F]{2}$/.test(c))
          )
            throw new Error("01–FF のチャンネルを最大 16 個指定してください");
          customChannels = [...new Set(channels)];
          group = "custom";
          ($("lane-group") as HTMLSelectElement).value = "custom";
          closeModal();
          renderLanes();
          drawChart();
        },
      },
    ],
  );
}
function point(event: PointerEvent) {
  const rect = $("chart").getBoundingClientRect(),
    g = geometry();
  const x = event.clientX - rect.left,
    y = event.clientY - rect.top + $("chart-scroll").scrollTop;
  const beat = Math.max(0, (y - 20) / zoom),
    lane = Math.max(
      0,
      Math.min(
        g.lanes.length - 1,
        Math.floor(
          (x - g.left) / ((g.width - g.left - g.right) / g.lanes.length),
        ),
      ),
    );
  return {
    x,
    y,
    beat: grid ? Math.round(beat * grid) / grid : Math.round(beat * 192) / 192,
    lane,
  };
}
function hitNote(p: ReturnType<typeof point>) {
  return project.notes.find(
    (n) =>
      noteLaneIndices(n).includes(p.lane) &&
      Math.abs(n.beat - p.beat) < Math.max(0.08, 7 / zoom),
  );
}
function addNote(beat: number, laneIndexValue: number) {
  if (!editable()) return;
  const lane = currentLanes()[laneIndexValue];
  if (!lane) return;
  if (["02", "03", "08"].includes(lane.channel)) {
    toast("テンポ・小節長は専用操作で編集してください");
    return;
  }
  const soundId =
    autoLaneSound && group === "drums"
      ? defaultLaneSounds[lane.id] || resourceId
      : resourceId;
  let channel = lane.channel;
  const creatorLane = creatorLaneForChannel(channel);
  if (backSide && creatorLane?.back) channel = creatorLane.back;
  if (
    project.notes.some(
      (n) => n.channel === channel && Math.abs(n.beat - beat) < 1e-7,
    )
  )
    return;
  const binding =
    creatorLane &&
    getCreatorBindings(project).find((b) => b.lane === creatorLane.index);
  if (
    (group === "guitar" || group === "bass") &&
    laneIndexValue >= 1 &&
    laneIndexValue <= 5
  ) {
    const existing = project.notes.find(
      (n) =>
        Math.abs(n.beat - beat) < 0.0001 &&
        stringChannel(n.channel)?.instrument === group &&
        ["note", "open"].includes(stringChannel(n.channel)?.kind || ""),
    );
    if (existing) {
      const info = stringChannel(existing.channel)!;
      const frets = [...info.frets];
      if (!frets.includes(laneIndexValue - 1)) frets.push(laneIndexValue - 1);
      existing.channel = channelForFrets(group, frets);
      selection = new Set([existing.id]);
      return;
    }
  }
  const n: Note = {
    id: uid(),
    beat,
    channel,
    value:
      binding && (backSide ? binding.back : binding.front) !== "00"
        ? backSide
          ? binding.back
          : binding.front
        : soundId,
    lane: channelToLane(channel),
  };
  project.notes.push(n);
  selection = new Set([n.id]);
  expandBars();
  if (
    placementPreview &&
    isAudioChannel(n.channel) &&
    !getResourceAppearance(project, "WAV", n.value).bgm
  )
    transport
      .preview(n.value, aliases[n.lane || ""] || n.lane)
      .catch(handleError);
}
const canvas = $("chart");
canvas.addEventListener("pointerdown", (event) => {
  const e = event as PointerEvent;
  if (e.button !== 0 && e.button !== 2) return;
  if (!editable()) return;
  canvas.focus();
  const p = point(e);
  cursorBeat = p.beat;
  cursorLane = p.lane;
  if (p.x < geometry().left) {
    transport.seek(beatToSeconds(project, p.beat));
    drawChart();
    return;
  }
  const hit = hitNote(p);
  if (e.button === 2 || mode === "erase") {
    if (hit && checkpoint()) {
      project.notes = project.notes.filter((n) => n.id !== hit.id);
      selection.delete(hit.id);
      changed();
    }
    return;
  }
  dragStart = p;
  dragCurrent = p;
  dragMoved = false;
  drawn = false;
  dragMoving = mode === "select" && !!hit;
  dragOriginal = [];
  canvas.setPointerCapture(e.pointerId);
  if (mode === "select") {
    if (!e.shiftKey && !hit) selection.clear();
    if (hit) {
      if (e.shiftKey && selection.has(hit.id)) selection.delete(hit.id);
      else {
        if (!e.shiftKey && !selection.has(hit.id)) selection.clear();
        selection.add(hit.id);
      }
    }
    if (dragMoving)
      dragOriginal = project.notes
        .filter((n) => selection.has(n.id))
        .map((n) => ({ ...n }));
    renderInspector();
    drawChart();
  } else {
    if (checkpoint()) {
      addNote(p.beat, p.lane);
      drawn = true;
      changed();
    }
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragStart) return;
  const p = point(event as PointerEvent);
  dragCurrent = p;
  if (Math.abs(p.x - dragStart.x) + Math.abs(p.y - dragStart.y) > 5)
    dragMoved = true;
  if (mode === "select" && dragMoved) {
    if (dragMoving && dragOriginal.length) {
      const delta = p.beat - dragStart.beat;
      if (dragOriginal.every((n) => n.beat + delta >= 0)) {
        for (const original of dragOriginal) {
          const n = project.notes.find((n) => n.id === original.id);
          if (n) n.beat = original.beat + delta;
        }
      }
    }
    drawChart();
  } else if (mode === "draw" && drawn) {
    addNote(p.beat, p.lane);
    dirty = true;
    drawChart();
  }
});
canvas.addEventListener("pointerup", (event) => {
  if (!dragStart) return;
  const p = point(event as PointerEvent);
  if (mode === "select" && dragMoved && dragMoving) {
    const moved = project.notes
      .filter((n) => selection.has(n.id))
      .map((n) => ({ ...n }));
    for (const original of dragOriginal) {
      const n = project.notes.find((n) => n.id === original.id);
      if (n) Object.assign(n, original);
    }
    let valid = true;
    try {
      assertNoNewNoteCollisions(
        project.notes,
        project.notes.map((n) => moved.find((m) => m.id === n.id) || n),
      );
    } catch (e) {
      handleError(e);
      valid = false;
    }
    if (valid && checkpoint()) {
      for (const next of moved) {
        const n = project.notes.find((n) => n.id === next.id);
        if (n) Object.assign(n, next);
      }
      expandBars();
      drawn = true;
    }
  } else if (mode === "select" && dragMoved) {
    const lo = Math.min(dragStart.beat, p.beat),
      hi = Math.max(dragStart.beat, p.beat),
      left = Math.min(dragStart.lane, p.lane),
      right = Math.max(dragStart.lane, p.lane);
    project.notes.forEach((n) => {
      const lane = laneIndex(n);
      if (
        n.beat >= lo - 0.01 &&
        n.beat <= hi + 0.01 &&
        lane >= left &&
        lane <= right
      )
        selection.add(n.id);
    });
  }
  dragStart = null;
  dragMoved = false;
  if (drawn) changed();
  else {
    renderInspector();
    $("selection-count").textContent = `${selection.size} ノート選択`;
    drawChart();
  }
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
function on(id: string, fn: () => unknown | Promise<unknown>) {
  $(id).onclick = () => Promise.resolve(fn()).catch(handleError);
}
on("new", async () => {
  if (dirty && !confirm("変更を保存せず新しい譜面を作りますか？")) return;
  const p = createDemoProject();
  p.notes = [];
  p.metadata.title = "新しい曲";
  p.metadata.artist = "";
  p.barCount = 16;
  files = [];
  projectId = undefined;
  referencePath = "";
  youtubeId = "";
  waveform = null;
  transport.detachYouTube();
  await transport.setReferenceAudio(null);
  setProject(p);
  await installKit();
  changed();
});
on("open", openDialog);
on("save", () => saveProject());
on("export", exportDialog);
on("settings", settingsDialog);
on("play", () => {
  if (transport.isPlaying) transport.pause();
  else return transport.play();
});
on("stop", () => {
  transport.pause();
  transport.seek(0);
  cursorBeat = 0;
  drawChart();
});
on("tap", tapBPM);
on("loop", () => {
  loopOn = !loopOn;
  updateLoop();
});
on("follow", () => {
  follow = !follow;
  $("follow").classList.toggle("active", follow);
});
on("mobile-inspector", () => {
  $("rightbar").classList.toggle("open");
});
on("mobile-samples", () => {
  $("leftbar").classList.toggle("open");
});
for (const m of ["draw", "select", "erase"] as const)
  on("mode-" + m, () => {
    mode = m;
    for (const x of ["draw", "select", "erase"])
      $("mode-" + x).classList.toggle("active", x === m);
  });
on("undo", () => {
  if (!undoStack.length) return;
  redoStack.push(historySnapshot());
  project = undoStack.pop()!;
  restoreHistoryState(project);
  selection.clear();
  changed();
});
on("redo", () => {
  if (!redoStack.length) return;
  undoStack.push(historySnapshot());
  project = redoStack.pop()!;
  restoreHistoryState(project);
  selection.clear();
  changed();
});
($("bpm") as HTMLInputElement).onchange = () => {
  const bpm = Number(value("bpm"));
  if (bpm > 0 && bpm < 2000 && checkpoint()) {
    project.metadata.bpm = bpm;
    changed();
  } else render();
};
($("speed") as HTMLSelectElement).onchange = () =>
  transport.setRate(Number(value("speed")));
($("metro") as HTMLInputElement).onchange = () => syncTransport();
for (const id of ["loop-a", "loop-b"])
  $<HTMLInputElement>(id).onchange = updateLoop;
($("grid") as HTMLSelectElement).onchange = () => {
  grid = Number(value("grid"));
  drawChart();
};
($("zoom") as HTMLInputElement).oninput = () => {
  zoom = Number(value("zoom"));
  drawChart();
};
($("lane-group") as HTMLSelectElement).onchange = () => {
  group = value("lane-group");
  selection.clear();
  renderLanes();
  renderInspector();
  drawChart();
};
on("channels", channelsDialog);
on("more-edit", editMenu);
on("quantize", () => {
  if (!selection.size || !grid || !checkpoint()) return;
  const next = project.notes.map((n) =>
    selection.has(n.id) ? { ...n, beat: Math.round(n.beat * grid) / grid } : n,
  );
  try {
    assertNoNewNoteCollisions(project.notes, next);
  } catch (e) {
    undoStack.pop();
    handleError(e);
    return;
  }
  project.notes = next;
  changed();
});
($("bank") as HTMLSelectElement).onchange = () => {
  selectedBank = value("bank");
  resourceId = bankResources()[0]?.id || "01";
  renderResources();
};
($("resource-filter") as HTMLInputElement).oninput = () => {
  filter = value("resource-filter");
  renderResources();
};
on("add-resource", () => resourceDialog(true));
on("edit-resource", () => resourceDialog());
on("import-audio", () => chooseFiles("audio"));
on("import-folder", () => chooseFolder(true));
on("reorder-resource", () => {
  modal(
    "リソース ID の変更 / 入れ替え",
    `<div class="field-grid"><label class="stack">元の ID<input id="swap-a" value="${esc(resourceId)}" maxlength="2"></label><label class="stack">移動先 ID<input id="swap-b" value="01" maxlength="2"></label></div><div class="note-box">移動先が使用中なら入れ替えます。このバンクを参照するチップも更新します。</div>`,
    [
      {
        label: "変更",
        primary: true,
        action: async () => {
          if (!checkpoint()) return;
          const a = value("swap-a").toUpperCase(),
            b = value("swap-b").toUpperCase();
          if (selectedBank === "WAV") {
            const { swapResourceIds, reorderResourceIds } =
              await import("./edit");
            project = project.resources[b]
              ? swapResourceIds(project, a, b)
              : reorderResourceIds(project, { [a]: b });
          } else {
            const { reorderMediaResources } = await import("./media");
            const ids = bankResources().map((r) => r.id);
            const ia = ids.indexOf(a),
              ib = ids.indexOf(b);
            if (ia < 0 || ib < 0)
              throw new Error("画像・動画の ID 入れ替えは両方の定義が必要です");
            [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
            project = reorderMediaResources(
              project,
              selectedBank as "BMP" | "BMPTEX" | "AVI",
              ids,
            );
          }
          resourceId = b;
          closeModal();
          await syncSamples();
          changed();
        },
      },
    ],
  );
});
($("kit-select") as HTMLSelectElement).onchange = () => {
  const id = value("kit-select");
  if (
    id &&
    confirm(
      "ドラムレーンの音源定義をこのキットへ切り替えますか？ 元の素材ファイルは残ります。",
    )
  )
    applyBundledKit(id as KitId).catch(handleError);
};
($("auto-lane") as HTMLInputElement).onchange = () =>
  (autoLaneSound = ($("auto-lane") as HTMLInputElement).checked);
$("samples").onclick = (e) => {
  const target = e.target as HTMLElement;
  const audition = target.closest<HTMLElement>("[data-audition]");
  if (audition) {
    if (selectedBank === "WAV") {
      const r = project.resources[audition.dataset.audition!];
      if (auditionId === r.id) {
        transport.stopPreview();
        auditionId = "";
        return;
      }
      auditionId = r.id;
      transport
        .preview(r.id, "SN", (r.volume ?? 100) / 100, (r.pan ?? 0) / 100)
        .catch(handleError);
    } else previewResource(audition.dataset.audition!);
    return;
  }
  const item = target.closest<HTMLElement>("[data-resource]");
  if (item) {
    resourceId = item.dataset.resource!;
    renderResources();
  }
};
on("manage-assets", async () => {
  const estimate = await storageEstimate();
  modal(
    "ファイル・保存容量",
    `<div class="note-box">使用量 ${((estimate.usage || 0) / 1024 / 1024).toFixed(1)} MB / 保存上限 ${((estimate.quota || 0) / 1024 / 1024).toFixed(0)} MB。ブラウザの自動削除に備えて ZIP を保存してください。</div><div class="row"><button id="assets-add-images">画像・動画を追加</button><button id="assets-media-preview">BGA プレビュー</button><button id="assets-transform">切抜き・移動設定</button></div><table><thead><tr><th>ファイル</th><th>サイズ</th><th></th></tr></thead><tbody>${files.map((f, i) => `<tr><td>${esc(f.path)}</td><td>${(f.size / 1024).toFixed(0)} KB</td><td><button data-remove-asset="${i}" class="danger">削除</button></td></tr>`).join("")}</tbody></table>`,
  );
  $("assets-add-images").onclick = () => chooseFiles("media");
  $("assets-media-preview").onclick = () => openMediaPreview();
  $("assets-transform").onclick = () => transformDialog();
  $("modal-root")
    .querySelectorAll<HTMLButtonElement>("[data-remove-asset]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const f = files[Number(b.dataset.removeAsset)];
          if (
            confirm(
              `${f.path} のブラウザ内コピーを削除しますか？ 元のローカルファイルは削除しません。`,
            )
          ) {
            files = files.filter((x) => x !== f);
            syncSamples();
            changed();
            closeModal();
          }
        }),
    );
});
on("reference-open", () => {
  $<HTMLInputElement>("reference-input").value = "";
  $("reference-input").click();
});
on("youtube-open", youtubeDialog);
on("reference-clear", async () => {
  referenceGeneration++;
  transport.detachYouTube();
  await transport.setReferenceAudio(null);
  youtubeId = "";
  referencePath = "";
  referenceDuration = 0;
  waveform = null;
  $("youtube-dock")?.remove();
  $("reference-name").textContent = "原曲を追加して、同じ時間軸で耳コピ";
  drawWaveform();
  renderInspector();
});
$("waveform").onclick = (e) => {
  const rect = $("waveform").getBoundingClientRect(),
    time =
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) *
      Math.max(
        Math.max(0, referenceDuration - transport.referenceOffset),
        beatToSeconds(project, durationBeats(project)),
      );
  transport.seek(time);
  cursorBeat = secondsToBeat(project, time);
  drawChart();
  drawWaveform();
};
$<HTMLInputElement>("file-input").onchange = () =>
  processFiles(
    Array.from($<HTMLInputElement>("file-input").files || []),
    inputPurpose,
  ).catch(handleError);
$<HTMLInputElement>("folder-input").onchange = () =>
  processFiles(
    Array.from($<HTMLInputElement>("folder-input").files || []),
    folderAudioOnly ? "audio" : "chart",
    true,
  ).catch(handleError);
$<HTMLInputElement>("reference-input").onchange = async () => {
  const file = $<HTMLInputElement>("reference-input").files?.[0];
  if (!file) return;
  try {
    let path = "reference/" + file.name;
    const f = {
      path,
      name: file.name,
      blob: file,
      hash: await hashBlob(file),
      size: file.size,
      type: file.type,
    };
    files = files.filter((x) => x.path !== path);
    files.push(f);
    await loadReference(file, path);
    revision++;
    dirty = true;
    await saveProject(true);
  } catch (e) {
    handleError(e);
  }
};
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      activeTab = b.dataset.tab!;
      document
        .querySelectorAll("[data-tab]")
        .forEach((x) =>
          x.classList.toggle(
            "active",
            (x as HTMLElement).dataset.tab === activeTab,
          ),
        );
      renderInspector();
    }),
);
$("inspector").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!b) return;
  Promise.resolve(
    (async () => {
      if (b.dataset.removeTempo) {
        if (checkpoint()) {
          project.tempos = project.tempos.filter(
            (t) => t.id !== b.dataset.removeTempo,
          );
          changed();
        }
        return;
      }
      switch (b.id) {
        case "metadata":
          metadataDialog();
          break;
        case "source":
          sourceDialog();
          break;
        case "delete-notes":
          deleteNotes();
          break;
        case "edit-hold": {
          const n = project.notes.find(
            (n) =>
              selection.has(n.id) && stringChannel(n.channel)?.kind === "note",
          );
          if (!n) throw new Error("フレット付きの開始ノートを選択してください");
          const old = getHoldSpans(project).find((s) => s.start.id === n.id);
          modal(
            "ホールド区間",
            `<p>NX の 2C / 2D マーカーを開始・終端に配置します。OPEN は不可、区間内と終端に別の演奏ノートを置けません。</p><label class="stack">終端の拍<input id="hold-end" type="number" step=".25" value="${old?.end.beat || n.beat + 2}"></label>`,
            [
              {
                label: "区間を設定",
                primary: true,
                action: () => {
                  const next = setHold(
                    project,
                    n.id,
                    Number(value("hold-end")),
                  );
                  serializeDTX(next);
                  if (checkpoint()) {
                    project = next;
                    expandBars();
                    changed();
                    closeModal();
                  }
                },
              },
              {
                label: "ホールドを解除",
                action: () => {
                  const next = removeHold(project, n.id);
                  if (checkpoint()) {
                    project = next;
                    changed();
                    closeModal();
                  }
                },
              },
            ],
          );
          break;
        }
        case "apply-note": {
          const chosen = project.notes.filter((n) => selection.has(n.id));
          const delta = Number(value("note-beat")) - (chosen[0]?.beat || 0),
            channel = value("note-channel").trim().toUpperCase(),
            v = value("note-value").trim().toUpperCase(),
            size = value("note-size").trim();
          if (
            !Number.isFinite(delta) ||
            chosen.some((n) => n.beat + delta < 0) ||
            (channel &&
              (!/^[0-9A-F]{2}$/.test(channel) ||
                ["00", "02", "03", "08"].includes(channel))) ||
            (v && (!/^[0-9A-Z]{2}$/.test(v) || v === "00")) ||
            (size &&
              (!Number.isFinite(Number(size)) ||
                Number(size) < 1 ||
                Number(size) > 200))
          )
            throw new Error(
              "チップ位置・チャンネル・値を確認してください。テンポは専用操作で変更します。",
            );
          assertNoNewNoteCollisions(
            project.notes,
            project.notes.map((n) =>
              selection.has(n.id)
                ? { ...n, beat: n.beat + delta, channel: channel || n.channel }
                : n,
            ),
          );
          if (!checkpoint()) return;
          for (const n of chosen) {
            n.beat += delta;
            if (channel) {
              n.channel = channel;
              n.lane = channelToLane(channel);
            }
            if (v) n.value = v;
            if (size && isAudioChannel(n.channel) && project.resources[n.value])
              project.resources[n.value].size = Number(size);
          }
          expandBars();
          changed();
          break;
        }
        case "apply-frets": {
          const frets = [
            ...$("inspector").querySelectorAll<HTMLInputElement>(
              "[data-fret]:checked",
            ),
          ].map((x) => Number(x.dataset.fret));
          const ids = project.notes
            .filter(
              (n) =>
                selection.has(n.id) &&
                ["note", "open"].includes(stringChannel(n.channel)?.kind || ""),
            )
            .map((n) => n.id);
          const next = setStringFrets(project, ids, frets);
          if (checkpoint()) {
            project = next;
            changed();
          }
          break;
        }
        case "bar-edit":
          await barDialog();
          break;
        case "tempo-add":
          addTempoDialog();
          break;
        case "mark-a":
          ($("loop-a") as HTMLInputElement).value = String(
            Math.round(
              secondsToBeat(project, transport.currentTime) * (grid || 4),
            ) / (grid || 4),
          );
          updateLoop();
          break;
        case "mark-b":
          ($("loop-b") as HTMLInputElement).value = String(
            Math.round(
              secondsToBeat(project, transport.currentTime) * (grid || 4),
            ) / (grid || 4),
          );
          updateLoop();
          break;
        case "loop-selection": {
          const chosen = project.notes.filter((n) => selection.has(n.id));
          if (!chosen.length)
            throw new Error("ループするチップを選択してください");
          ($("loop-a") as HTMLInputElement).value = String(
            Math.min(...chosen.map((n) => n.beat)),
          );
          ($("loop-b") as HTMLInputElement).value = String(
            Math.max(...chosen.map((n) => n.beat)) + 1,
          );
          loopOn = true;
          updateLoop();
          break;
        }
        case "midi-live":
          midiUI.open();
          break;
        case "beat-analysis":
          openBeatDialog({
            show: (title, html) => modal(title, html),
            close: closeModal,
            getSource: () => {
              const f = referencePath && findFile(referencePath);
              return f
                ? {
                    blob: f.blob,
                    name: f.path,
                    offset: transport.referenceOffset,
                  }
                : null;
            },
            getRevision: () => revision,
            seekSource: (seconds) => {
              transport.seek(Math.max(0, seconds - transport.referenceOffset));
              void transport.play().catch(handleError);
            },
            error: handleError,
            apply: (plan) => {
              if (!editable())
                throw new Error("保護された譜面は変更できません");
              if (
                !plan.tempos.length ||
                plan.tempos.some(
                  (t) =>
                    !Number.isFinite(t.bpm) ||
                    t.bpm < 0.1 ||
                    t.bpm > 10000 ||
                    t.beat < 0 ||
                    t.beat >= 230400,
                )
              )
                throw new Error("DTX の BPM / 拍範囲を超えています");
              const next = structuredClone(project);
              next.metadata.bpm = plan.tempos[0].bpm;
              next.metadata.baseBpm = 0;
              next.bpmDefinitions = {};
              next.tempos = plan.tempos.slice(1).map((t) => ({
                ...t,
                id: uid(),
                channel: "08" as const,
                value: "01",
              }));
              serializeDTX(next);
              if (!checkpoint()) return;
              project = next;
              transport.setReferenceOffset(plan.sourceOffsetSeconds);
              expandBars();
              changed();
              toast(
                "拍位置とテンポマップを適用しました。メトロノームで確認してください",
              );
            },
          });
          break;
        case "reference-bgm": {
          const source = referencePath && findFile(referencePath);
          if (!source)
            throw new Error(
              "ローカル原曲を先に読み込んでください。YouTube は音源として書き出せません。",
            );
          const offset = transport.referenceOffset;
          if (
            !confirm(
              "この原曲をゲーム用 BGM として譜面と ZIP に含めます。正のオフセットはブラウザ内で WAV にトリムし、負のオフセットはチップ位置を遅らせます。素材の利用権はお持ちですか？",
            )
          )
            return;
          const originalRevision = revision;
          let asset = source;
          if (offset > 0) {
            const blob = await trimReferenceAudio(source.blob, offset);
            if (revision !== originalRevision)
              throw new Error("作業中に譜面が変わったため処理を中止しました");
            const path = `reference/bgm-aligned-${Date.now()}.wav`;
            asset = {
              path,
              name: path.split("/").at(-1)!,
              blob,
              hash: await hashBlob(blob),
              size: blob.size,
              type: "audio/wav",
            };
          }
          if (!checkpoint()) return;
          if (asset !== source) files.push(asset);
          let r = Object.values(project.resources).find(
            (r) => r.file === asset.path,
          );
          if (!r) {
            const id = nextResourceId();
            r = { id, file: asset.path, volume: 100, label: "参照 BGM" };
            project.resources[id] = r;
          }
          project.notes = project.notes.filter(
            (n) =>
              !(
                n.channel === "01" &&
                (n.value === r!.id || n.value === referenceBgmId)
              ),
          );
          referenceBgmId = r.id;
          project.notes.push({
            id: uid(),
            beat: offset < 0 ? secondsToBeat(project, -offset) : 0,
            channel: "01",
            value: r.id,
          });
          project = setResourceAppearance(project, "WAV", r.id, { bgm: true });
          expandBars();
          await syncSamples();
          changed();
          toast("原曲を BGM 登録しました。参照再生中の重複音は抑制されます。");
          break;
        }
        case "shift-chart": {
          const delta = Number(
            prompt("全チップを移動する拍数（負数で前へ）", "0"),
          );
          if (!Number.isFinite(delta)) return;
          if (project.notes.some((n) => n.beat + delta < 0))
            throw new Error("先頭より前にチップが移動します");
          if (checkpoint()) {
            project.notes.forEach((n) => (n.beat += delta));
            project.tempos.forEach(
              (t) => (t.beat = Math.max(0, t.beat + delta)),
            );
            expandBars();
            changed();
          }
          break;
        }
        case "tap-assist":
          tapBPM();
          break;
        case "midi-import":
          chooseFiles("midi");
          break;
        case "show-youtube":
          showYouTube();
          break;
        case "ai-generate":
          await generateAI();
          break;
        case "ai-multi":
          await generateVariants();
          break;
        case "local-generate":
          await generateAI(true);
          break;
        case "ai-settings":
          settingsDialog();
          break;
        case "ai-metadata":
          await metadataAI();
          break;
        case "ai-adopt":
          await adoptProposal();
          break;
        case "ai-discard":
          aiProposal = null;
          syncTransport();
          renderInspector();
          drawChart();
          break;
        case "ai-audition": {
          if (!aiProposal) return;
          const keep = new Set(aiProposal.keepIds);
          transport.setEvents(
            project.notes
              .filter((n) => keep.has(n.id) && isAudioChannel(n.channel))
              .map((n) => ({
                time: beatToSeconds(project, n.beat),
                resourceId: n.value,
                channel: n.channel,
                lane: channelToLane(n.channel),
                volume: (project.resources[n.value]?.volume ?? 100) / 100,
                pan: (project.resources[n.value]?.pan ?? 0) / 100,
              })),
            beatToSeconds(project, durationBeats(project)),
          );
          transport.seek(beatToSeconds(project, loopOn ? loopStart : 0));
          await transport.play();
          break;
        }
      }
    })(),
  ).catch(handleError);
});
$("inspector").addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "drum-volume")
    transport.setDrumVolume(Number(input.value) / 100);
  if (input.id === "reference-volume")
    transport.setReferenceVolume(Number(input.value) / 100);
  if (input.id === "latency")
    transport.latencyOffset = Number(input.value) / 1000;
  if (input.id === "reference-offset") {
    const offset = Number(input.value);
    if (Number.isFinite(offset)) {
      transport.setReferenceOffset(offset);
      revision++;
      dirty = true;
      drawWaveform();
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => saveProject(true), 1600);
    }
  }
  if (input.id === "record") recordMode = input.checked;
  if (input.id === "placement-preview") placementPreview = input.checked;
  if (input.id === "bgm-only") {
    bgmOnly = input.checked;
    syncTransport();
  }
});
function previewResource(id: string) {
  const r = bankResources().find((r) => r.id === id),
    f = r && findFile(r.file);
  if (!f) {
    toast("ファイルを読み込んでください", true);
    return;
  }
  const url = URL.createObjectURL(f.blob);
  modal(
    r!.file,
    selectedBank === "AVI"
      ? `<video src="${url}" controls style="width:100%"></video>`
      : `<img src="${url}" alt="ローカル画像プレビュー" style="width:100%;object-fit:contain;max-height:60vh">`,
  );
}
let mediaPreview:
  | {
      update: (time: number, playing: boolean, rate: number) => void;
      dispose: () => void;
    }
  | undefined;
async function openMediaPreview() {
  const { LocalMediaPreview } = await import("./media");
  modal(
    "BGA / 動画プレビュー",
    `<div class="row"><button id="media-play">再生 / 一時停止</button><button id="media-start">先頭へ</button></div><div id="media-preview" style="position:relative;aspect-ratio:4/3;background:#000"></div><div class="note-box">ローカル画像・ブラウザがデコードできる動画を表示します。古い AVI コーデックや BGAPAN の特殊変換は制約があります。ゲームでの表示を最終確認してください。</div>`,
  );
  $("media-play").onclick = () => {
    if (transport.isPlaying) transport.pause();
    else transport.play().catch(handleError);
  };
  $("media-start").onclick = () => transport.seek(0);
  mediaPreview?.dispose();
  mediaPreview = new LocalMediaPreview($("media-preview"), (message) =>
    toast(message, true),
  );
  (mediaPreview as InstanceType<typeof LocalMediaPreview>).setProject(
    project,
    files,
  );
  mediaPreview.update(
    transport.currentTime,
    transport.isPlaying,
    transport.rate,
  );
}
on("help", () =>
  modal(
    "使い方 / ショートカット",
    `<div class="note-box">読み込み → 原曲の BPM を合わせる → A/B ループ → 打ち込み → 別難易度を作る → DTX + 音源を書き出す。内蔵 MIDI 音源は MIT ライセンスです。書き出し ZIP に付属するライセンス表記を保持してください。</div><div class="shortcuts"><span>再生 / 一時停止</span><kbd class="kbd">Space</kbd><span>鉛筆 / 選択 / 消去</span><kbd class="kbd">P / V / E</kbd><span>元に戻す / やり直し</span><kbd class="kbd">Ctrl Z / Ctrl Shift Z</kbd><span>保存</span><kbd class="kbd">Ctrl S</kbd><span>コピー / 切り取り / 貼り付け</span><kbd class="kbd">Ctrl C / X / V</kbd><span>表示レーン全選択</span><kbd class="kbd">Ctrl A</kbd><span>選択を削除</span><kbd class="kbd">Delete</kbd><span>選択をグリッド単位で移動</span><kbd class="kbd">↑ / ↓</kbd><span>キーボード打ち込み</span><kbd class="kbd">A S D F G H J K L ;</kbd></div><div class="safety-note">DTX と CP932 を中心に設計。RANDOM / IF など分岐があるファイルは原文を保護します。Web から Windows の外部ビューワーを自動起動することはできません。YouTube の同期はサンプル精度ではありません。実機の DTXManiaNX で最終確認してください。</div>`,
  ),
);
document.addEventListener("keydown", (e) => {
  const element = e.target as HTMLElement;
  if (e.key === "Escape" && $("modal-root").children.length) {
    aiController?.abort();
    closeModal();
    return;
  }
  if (
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
    element.isContentEditable
  )
    return;
  if (e.key === "Escape") {
    aiController?.abort();
    closeModal();
    return;
  }
  if ($("modal-root").children.length) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    const k = e.key.toLowerCase();
    if (["s", "z", "y", "c", "v", "x", "a"].includes(k)) e.preventDefault();
    if (k === "s") saveProject();
    if (k === "z") $(e.shiftKey ? "redo" : "undo").click();
    if (k === "y") $("redo").click();
    if (k === "c") copyNotes();
    if (k === "x") {
      copyNotes();
      deleteNotes();
    }
    if (k === "v") pasteNotes();
    if (k === "a") {
      selection = new Set(
        project.notes.filter((n) => laneIndex(n) >= 0).map((n) => n.id),
      );
      render();
    }
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    $("play").click();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteNotes();
    return;
  }
  if (["ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    moveNotes((e.key === "ArrowUp" ? -1 : 1) / (grid || 4));
    return;
  }
  const key = e.key.toLowerCase();
  if (key === "p") $("mode-draw").click();
  if (key === "v") $("mode-select").click();
  if (key === "e") $("mode-erase").click();
  const i = ["a", "s", "d", "z", "f", "g", "h", "j", "k", "l", ";"].indexOf(
    key,
  );
  if (i >= 0 && !e.repeat) {
    const beat =
      recordMode && transport.isPlaying
        ? secondsToBeat(project, transport.currentTime)
        : cursorBeat;
    if (checkpoint()) {
      addNote(Math.round(beat * (grid || 192)) / (grid || 192), i);
      changed();
    }
  }
});
transport.setDrumVolume(0.8);
transport.setReferenceVolume(0.7);
let lastFrame = 0;
let midiBoundary = performance.now();
let previousTransport = { time: 0, wall: performance.now(), playing: false };
transport.subscribe((state) => {
  const wall = performance.now();
  const expected =
    previousTransport.time +
    (previousTransport.playing
      ? ((wall - previousTransport.wall) / 1000) * state.rate
      : 0);
  if (
    state.playing !== previousTransport.playing ||
    Math.abs(state.time - expected) > 0.12
  )
    midiBoundary = wall;
  previousTransport = { time: state.time, wall, playing: state.playing };
  if (performance.now() - lastFrame < 30 && state.playing) return;
  lastFrame = performance.now();
  const beat = secondsToBeat(project, state.time),
    pos = beatToBar(project, Math.max(0, beat));
  $("time").innerHTML =
    `${formatTime(state.time)}<small>BAR ${String(pos.bar + 1).padStart(3, "0")} · BEAT ${(pos.fraction * pos.length + 1).toFixed(2)}</small>`;
  if (state.youtubeError) $("reference-name").textContent = state.youtubeError;
  else if (youtubeId && state.youtubeStatus)
    $("reference-name").textContent = "YouTube · " + state.youtubeStatus;
  $("play").textContent = state.playing ? "❚❚" : "▶";
  $("play").setAttribute("aria-label", state.playing ? "一時停止" : "再生");
  if (state.playing) {
    cursorBeat = beat;
    const scroller = $("chart-scroll"),
      y = beat * zoom + 20;
    if (
      follow &&
      (y < scroller.scrollTop + 30 ||
        y > scroller.scrollTop + scroller.clientHeight - 80)
    )
      scroller.scrollTop = Math.max(0, y - scroller.clientHeight * 0.3);
  }
  drawChart();
  drawWaveform();
  if ($("media-preview"))
    mediaPreview?.update(state.time, state.playing, state.rate);
});
$("chart-scroll").addEventListener("scroll", () => drawChart());
window.addEventListener("resize", () => {
  drawChart();
  drawWaveform();
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function applyBundledKit(id: KitId, initial = false) {
  const baseline = revision;
  const loaded = await loadKit(id);
  if (revision !== baseline) {
    toast("読込中に譜面が変更されたためキット適用を中止しました", true);
    return;
  }
  if (!initial && !checkpoint()) return;
  const refs = new Map<string, string>();
  for (const lane of Object.keys(loaded.laneFiles)) {
    let rid = defaultLaneSounds[lane];
    if (!rid || !project.resources[rid]) rid = nextResourceId();
    project.resources[rid] = {
      id: rid,
      file: loaded.laneFiles[lane],
      volume: 100,
    };
    defaultLaneSounds[lane] = rid;
    refs.set(lane, rid);
  }
  files = files.filter((f) => !loaded.files.some((n) => n.path === f.path));
  files.push(...loaded.files);
  for (const n of project.notes) {
    const lane =
      n.channel === "18"
        ? "OH"
        : n.channel === "1C"
          ? "LB"
          : channelToLane(n.channel);
    if (lane && refs.has(lane)) n.value = refs.get(lane)!;
  }
  await syncSamples();
  if (!initial) changed();
  else render();
  toast(`${loaded.preset.name} キットを読み込みました`);
}
async function boot() {
  await installKit();
  render();
  const last = localStorage.getItem("dtx-studio-last");
  if (last) {
    try {
      const saved = await store.load<{
        project: Project;
        referencePath: string;
      }>(last);
      if (saved) {
        sourceChartPath = String(
          (saved.data as { chartPath?: string }).chartPath || "",
        );
        files = saved.files;
        projectId = saved.id;
        setProject(
          validateProjectManifest({ version: 1, ...saved.data }).project,
        );
        transport.setReferenceOffset(
          Number(
            (saved.data as { referenceOffset?: number }).referenceOffset,
          ) || 0,
        );
        referencePath = saved.data.referencePath || "";
        referenceBgmId = String(
          (saved.data as { referenceBgmId?: string }).referenceBgmId || "",
        );
        const f = referencePath && findFile(referencePath);
        if (f) await loadReference(f.blob, f.path);
      }
    } catch {
      toast("前回の復元に失敗しました。保存一覧から開き直してください。", true);
    }
  }
  if (!last) {
    try {
      await applyBundledKit("standard", true);
    } catch {
      toast("内蔵 MIDI 音源を読み込めません。合成練習音で開始しました。", true);
    }
  }
  render();
}
const libraryUI = createLibraryUI({
  show: (title, html) => modal(title, html),
  close: closeModal,
  getCurrent: () => ({ project, files }),
  toast,
  error: handleError,
  addCollection: async (collection) => {
    if (!editable()) return;
    if (
      Object.keys(project.resources).length + collection.resources.length >
      1295
    )
      throw new Error("WAV ID の空きが不足しています");
    const baseline = revision;
    const prefix = `library/${uid()}/`;
    const imported = collection.files.map((f) => ({
      ...f,
      path: prefix + f.path,
    }));
    const provenance = new Blob(
      [
        JSON.stringify(
          {
            collection: collection.name,
            importedAt: new Date().toISOString(),
            originalPaths: collection.files.map((f) => f.path),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const path = prefix + "COLLECTION-ORIGIN.json";
    imported.push({
      path,
      name: "COLLECTION-ORIGIN.json",
      blob: provenance,
      hash: await hashBlob(provenance),
      size: provenance.size,
      type: provenance.type,
    });
    if (revision !== baseline)
      throw new Error("読込中に譜面が変更されました。もう一度選択してください");
    if (!checkpoint()) return;
    files.push(...imported);
    for (const r of collection.resources) {
      const id = nextResourceId();
      project.resources[id] = {
        ...r,
        id,
        file: prefix + r.file,
        label: r.label || collection.name + " / " + r.file.split("/").at(-1),
      };
    }
    await syncSamples();
    changed();
    toast(`${collection.name} の音源を追加しました`);
  },
});
on("sound-collections", () => libraryUI.open());
const midiUI = createMidiUI({
  onArmed: (armed) => {
    $("midi-record-status").hidden = !armed;
  },
  show: (title, html) => modal(title, html),
  close: closeModal,
  toast,
  onHit: (hit, record) => {
    const r = project.resources[hit.target.value];
    if (!r) {
      toast(
        `MIDI 割当 WAV ${hit.target.value} がありません。機器設定でこの曲の WAV ID に合わせてください`,
        true,
      );
      return;
    }
    void transport
      .previewInput(
        r.id,
        channelToLane(hit.target.channel) || "SN",
        (((r.volume ?? 100) / 100) * hit.velocity) / 127,
        (r.pan ?? 0) / 100,
        hit.target.channel,
      )
      .catch(handleError);
    if (
      !record ||
      !editable() ||
      hit.timeStamp < midiBoundary ||
      ($("modal-root").childElementCount > 0 && !$("midi-editor"))
    )
      return;
    const beat = recordingBeat(hit.timeStamp, {
      nowMs: performance.now(),
      chartSeconds: transport.currentTime,
      playbackRate: Number(value("speed")),
      isPlaying: transport.isPlaying,
      latencyMs: (hit as typeof hit & { latencyMs?: number }).latencyMs || 0,
      secondsToBeat: (s) => secondsToBeat(project, s),
      quantizeBeat: grid ? (b) => Math.round(b * grid) / grid : undefined,
    });
    if (beat === null || beat >= 230400) return;
    if (
      project.notes.some(
        (n) =>
          n.channel === hit.target.channel && Math.abs(n.beat - beat) < 1e-7,
      )
    ) {
      toast("同じ拍・レーンの MIDI 入力を重複配置しません");
      return;
    }
    if (!checkpoint()) return;
    // DTX has per-WAV, not per-chip, volume. Reuse eight velocity-layer resource definitions.
    const volume = Math.max(
      1,
      Math.round(((r.volume ?? 100) * Math.ceil((hit.velocity / 127) * 8)) / 8),
    );
    let sound = Object.values(project.resources).find(
      (x) =>
        x.file === r.file &&
        (x.volume ?? 100) === volume &&
        (x.pan ?? 0) === (r.pan ?? 0),
    );
    if (!sound) {
      const id = nextResourceId();
      sound = {
        ...r,
        id,
        volume,
        label: `${r.label || r.file} · MIDI ${volume}%`,
      };
      project.resources[id] = sound;
    }
    const note: Note = {
      id: uid(),
      beat,
      channel: hit.target.channel,
      value: sound.id,
      lane: channelToLane(hit.target.channel),
    };
    project.notes.push(note);
    selection = new Set([note.id]);
    expandBars();
    changed();
  },
});
$("midi-record-status").onclick = () => midiUI.open();
boot().catch(handleError);

function searchDialog() {
  modal(
    "チップを検索",
    `<div class="field-grid"><label class="stack">チャンネル（空欄ですべて）<input id="search-channel" maxlength="2"></label><label class="stack">WAV / 値の開始（空欄ですべて）<input id="search-value" maxlength="2"></label><label class="stack">値の終了（空欄で開始値と同じ）<input id="search-value-end" maxlength="2"></label><label class="stack">表 / 裏<select id="search-side"><option value="all">両方</option><option value="front">表</option><option value="back">裏</option></select></label><label class="stack">開始小節<input id="search-start" type="number" min="1" value="1"></label><label class="stack">終了小節<input id="search-end" type="number" min="1" value="${project.barCount}"></label></div><label class="check-row"><input id="search-current" type="checkbox">現在の選択範囲だけを対象にする</label><div class="note-box">検索結果を選択して、移動・置換・表裏反転・削除できます。チャンネルは HH 11 / オープン HH 18 / ライド 19 / 左シンバル 1A などです。</div>`,
    [
      {
        label: "検索して選択",
        primary: true,
        action: () => {
          const ch = value("search-channel").trim().toUpperCase(),
            id = value("search-value").trim().toUpperCase(),
            idEnd = value("search-value-end").trim().toUpperCase() || id,
            side = value("search-side"),
            start = Number(value("search-start")) - 1,
            end = Number(value("search-end"));
          if (
            (ch && !/^[0-9A-F]{2}$/.test(ch)) ||
            (id && !/^[0-9A-Z]{2}$/.test(id)) ||
            (idEnd &&
              (!/^[0-9A-Z]{2}$/.test(idEnd) ||
                !id ||
                parseInt(idEnd, 36) < parseInt(id, 36))) ||
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            end <= start ||
            end > 3600
          )
            throw new Error("検索条件を確認してください");
          const from = barStartBeat(project, start),
            to = barStartBeat(project, end),
            scope = ($("search-current") as HTMLInputElement).checked;
          const found = project.notes.filter(
            (n) =>
              (!ch || n.channel === ch) &&
              (!id ||
                (parseInt(n.value, 36) >= parseInt(id, 36) &&
                  parseInt(n.value, 36) <= parseInt(idEnd, 36))) &&
              (side === "all" ||
                CREATOR_LANES.some(
                  (l) => (side === "back" ? l.back : l.front) === n.channel,
                )) &&
              n.beat >= from &&
              n.beat < to &&
              (!scope || selection.has(n.id)),
          );
          selection = new Set(found.map((n) => n.id));
          closeModal();
          render();
          if (found.length)
            $("chart-scroll").scrollTop = Math.max(
              0,
              found[0].beat * zoom - 30,
            );
          toast(`${found.length} チップが見つかりました`);
        },
      },
    ],
  );
}
function bindingsDialog() {
  const bindings = getCreatorBindings(project);
  modal(
    "表 / 裏レーンの音源割当",
    `<div class="note-box">打ち込み時にレーン専用の ID を使います。00 は未割当です。HH の表はクローズ、裏はオープン。BGA の裏チャンネルも保持します。</div><label class="stack">レーン<select id="bind-lane">${CREATOR_LANES.filter(
      (l) => l.bank,
    )
      .map(
        (l) =>
          `<option value="${l.index}">${esc(l.name)} · ${l.front}/${l.back} · ${l.bank}</option>`,
      )
      .join(
        "",
      )}</select></label><div class="field-grid"><label class="stack">表 ID<input id="bind-front" maxlength="2" value="00"></label><label class="stack">裏 ID<input id="bind-back" maxlength="2" value="00"></label></div>`,
    [
      {
        label: "割当を保存",
        primary: true,
        action: () => {
          const next = setCreatorBinding(project, {
            lane: Number(value("bind-lane")),
            front: value("bind-front").toUpperCase(),
            back: value("bind-back").toUpperCase(),
          });
          if (checkpoint()) {
            project = next;
            closeModal();
            changed();
          }
        },
      },
    ],
  );
  const load = () => {
    const b = bindings.find((b) => b.lane === Number(value("bind-lane")));
    ($("bind-front") as HTMLInputElement).value = b?.front || "00";
    ($("bind-back") as HTMLInputElement).value = b?.back || "00";
  };
  ($("bind-lane") as HTMLSelectElement).onchange = load;
  load();
}
on("bindings", bindingsDialog);
on("back-side", () => {
  backSide = !backSide;
  $("back-side").textContent = backSide ? "裏" : "表";
  $("back-side").classList.toggle("active", backSide);
});
on("palette-add", () => {
  if (!checkpoint()) return;
  const entries = getCreatorPalette(project),
    i = entries.findIndex(
      (e) => e.bank === selectedBank && e.id === resourceId,
    );
  if (i >= 0) entries.splice(i, 1);
  else entries.push({ bank: selectedBank as CreatorBank, id: resourceId });
  project = setCreatorPalette(project, entries);
  changed();
});
$("palette").onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-palette]");
  if (!b) return;
  const [bank, id] = b.dataset.palette!.split(":");
  selectedBank = bank;
  resourceId = id;
  ($("bank") as HTMLSelectElement).value = bank;
  renderResources();
};
async function generateVariants() {
  if (!getKey()) {
    settingsDialog();
    return;
  }
  if (
    !confirm(
      `同じ原本から BASIC / ADVANCED / EXTREME の 3 案を生成します。OpenRouter に匿名化したノート情報を送信し、API 料金が発生します。実行しますか？`,
    )
  )
    return;
  aiController?.abort();
  aiController = new AbortController();
  const baseline = JSON.stringify(project);
  modal(
    "3 難易度を生成中",
    `<div class="note-box">元譜面を保持したまま、3 案を生成しています。実音声は送信しません。</div>`,
    [
      {
        label: "中止",
        action: () => {
          aiController?.abort();
          closeModal();
        },
      },
    ],
  );
  try {
    const variants = await requestDifficultyVariants(
      getKey(),
      getModel(),
      project.notes,
      aiController.signal,
      {
        bpm: project.metadata.bpm,
        tempos: project.tempos,
        measures: Array.from({ length: project.barCount }, (_, bar) => ({
          startBeat: barStartBeat(project, bar),
          length: 4 * barLengthAt(project, bar),
        })),
      },
    );
    if (baseline !== JSON.stringify(project) || aiController.signal.aborted)
      throw new Error("元譜面の変更または中止により、候補を破棄しました");
    modal(
      "3 つの難易度候補",
      `<div class="note-box">原本は変更していません。各候補を確認し、必要なものだけ別譜面として保存できます。</div>${Object.entries(
        variants,
      )
        .map(
          ([level, p]) =>
            `<div class="inspector-card"><b>${esc(p.title)} · ${p.keepIds.length} チップ</b><p class="safety-note">${esc(p.rationale)}</p><button data-variant="${level}">この候補を比較</button></div>`,
        )
        .join("")}`,
      [
        {
          label: "3 案を別プロジェクトとして保存",
          primary: true,
          action: async () => {
            if (baseline !== JSON.stringify(project))
              throw new Error("元譜面が変更されました");
            for (const p of Object.values(variants)) {
              const candidate = structuredClone(project);
              candidate.notes = candidate.notes.filter((n) =>
                p.keepIds.includes(n.id),
              );
              candidate.metadata.title = title() + " [" + p.title + "]";
              delete candidate.originalText;
              delete candidate.originalFingerprint;
              await store.save({
                name: candidate.metadata.title,
                data: {
                  project: candidate,
                  referencePath,
                  youtubeId,
                  referenceBgmId,
                  referenceOffset: transport.referenceOffset,
                },
                files,
              });
            }
            closeModal();
            toast("3 難易度を保存しました。「開く」から切り替えられます");
          },
        },
      ],
    );
    $("modal-root")
      .querySelectorAll<HTMLButtonElement>("[data-variant]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            aiProposal =
              variants[b.dataset.variant as "easy" | "normal" | "hard"];
            closeModal();
            renderInspector();
            drawChart();
          }),
      );
  } catch (e) {
    closeModal();
    if (e instanceof DOMException && e.name === "AbortError") return;
    throw e;
  }
}
async function transformDialog() {
  const { getMediaTransforms, setMediaTransform, deleteMediaTransform } =
    await import("./media");
  const transforms = getMediaTransforms(project);
  modal(
    "BGA / 動画の切抜き・移動",
    `<div class="note-box">画像内の切抜き矩形と、画面 (278 × 355) 上の表示位置を指定します。BGAPAN / AVIPAN は開始から終了の矩形へ補間します。AVIPAN の見た目は NX の版によって異なるため実機確認が必要です。</div><label class="stack">既存の設定<select id="transform-existing"><option value="">新規</option>${transforms.map((t, i) => `<option value="${i}">${t.kind}${t.id} → ${t.resourceId}</option>`).join("")}</select></label><div class="field-grid"><label class="stack">種類<select id="transform-kind"><option>BGA</option><option>BGAPAN</option><option>AVIPAN</option></select></label><label class="stack">設定 ID<input id="transform-id" value="01" maxlength="2"></label><label class="stack">元リソース ID<input id="transform-source" value="01" maxlength="2"></label><label class="stack">継続 tick<input id="transform-ticks" type="number" min="0" value="192"></label></div><table><thead><tr><th>項目</th><th>開始</th><th>終了</th></tr></thead><tbody>${["sourceX", "sourceY", "width", "height", "destX", "destY"].map((k) => `<tr><td>${({ sourceX: "切抜き X", sourceY: "切抜き Y", width: "幅", height: "高さ", destX: "表示 X", destY: "表示 Y" } as Record<string, string>)[k]}</td><td><input id="transform-start-${k}" type="number" value="${k === "width" ? 278 : k === "height" ? 355 : 0}"></td><td><input id="transform-end-${k}" type="number" value="${k === "width" ? 278 : k === "height" ? 355 : 0}"></td></tr>`).join("")}</tbody></table>`,
    [
      {
        label: "削除",
        action: () => {
          const next = deleteMediaTransform(
            project,
            value("transform-kind") as "BGA" | "BGAPAN" | "AVIPAN",
            value("transform-id").toUpperCase(),
          );
          if (checkpoint()) {
            project = next;
            closeModal();
            changed();
          }
        },
      },
      {
        label: "保存",
        primary: true,
        action: () => {
          const rect = (prefix: string) =>
            Object.fromEntries(
              ["sourceX", "sourceY", "width", "height", "destX", "destY"].map(
                (k) => [k, Number(value(`transform-${prefix}-${k}`))],
              ),
            ) as {
              sourceX: number;
              sourceY: number;
              width: number;
              height: number;
              destX: number;
              destY: number;
            };
          const next = setMediaTransform(project, {
            kind: value("transform-kind") as "BGA" | "BGAPAN" | "AVIPAN",
            id: value("transform-id").toUpperCase(),
            resourceId: value("transform-source").toUpperCase(),
            durationTicks: Number(value("transform-ticks")),
            start: rect("start"),
            end: rect("end"),
          });
          if (checkpoint()) {
            project = next;
            closeModal();
            changed();
          }
        },
      },
    ],
  );
  ($("transform-existing") as HTMLSelectElement).onchange = () => {
    if (value("transform-existing") === "") return;
    const t = transforms[Number(value("transform-existing"))];
    ($("transform-kind") as HTMLSelectElement).value = t.kind;
    ($("transform-id") as HTMLInputElement).value = t.id;
    ($("transform-source") as HTMLInputElement).value = t.resourceId;
    ($("transform-ticks") as HTMLInputElement).value = String(t.durationTicks);
    for (const prefix of ["start", "end"] as const)
      for (const k of [
        "sourceX",
        "sourceY",
        "width",
        "height",
        "destX",
        "destY",
      ] as const)
        ($(`transform-${prefix}-${k}`) as HTMLInputElement).value = String(
          t[prefix][k],
        );
  };
}

on("palette-setup", () => {
  let presets: Record<
    string,
    {
      palette: ReturnType<typeof getCreatorPalette>;
      bindings: ReturnType<typeof getCreatorBindings>;
    }
  > = {};
  try {
    presets = JSON.parse(localStorage.getItem("dtx-palette-presets") || "{}");
  } catch {}
  modal(
    "パレットとレーン割当の設定",
    `<label class="check-row"><input id="palette-visible" type="checkbox" ${localStorage.getItem("dtx-palette-hidden") !== "1" ? "checked" : ""}>お気に入りパレットを表示</label><label class="stack">設定名<input id="palette-name" placeholder="練習用 / ジャズ用など" maxlength="80"></label><button id="palette-save-preset">現在のパレット・割当を保存</button><div class="note-box">設定はこのブラウザに保存します。WAV/BMP/AVI の ID を記録するため、別の曲では定義の対応を確認してください。素材自体は音源コレクションで管理します。</div>${Object.keys(
      presets,
    )
      .map(
        (name, i) =>
          `<div class="row"><span class="grow">${esc(name)}</span><button data-preset-load="${i}">適用</button><button data-preset-delete="${i}" class="danger">削除</button></div>`,
      )
      .join("")}`,
  );
  $("palette-visible").onchange = () => {
    localStorage.setItem(
      "dtx-palette-hidden",
      $<HTMLInputElement>("palette-visible").checked ? "0" : "1",
    );
    renderResources();
  };
  $("palette-save-preset").onclick = () => {
    const name = value("palette-name").trim();
    if (!name || ["__proto__", "constructor", "prototype"].includes(name)) {
      toast("設定名を入力してください", true);
      return;
    }
    presets[name] = {
      palette: getCreatorPalette(project),
      bindings: getCreatorBindings(project),
    };
    localStorage.setItem("dtx-palette-presets", JSON.stringify(presets));
    closeModal();
    toast("パレット設定を保存しました");
  };
  document.querySelectorAll<HTMLButtonElement>("[data-preset-load]").forEach(
    (b) =>
      (b.onclick = () => {
        try {
          const preset =
            presets[Object.keys(presets)[Number(b.dataset.presetLoad)]];
          let next = setCreatorPalette(project, preset.palette);
          for (const binding of preset.bindings)
            next = setCreatorBinding(next, binding);
          if (checkpoint()) {
            project = next;
            changed();
            closeModal();
          }
        } catch (e) {
          handleError(e);
        }
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-preset-delete]").forEach(
    (b) =>
      (b.onclick = () => {
        delete presets[Object.keys(presets)[Number(b.dataset.presetDelete)]];
        localStorage.setItem("dtx-palette-presets", JSON.stringify(presets));
        closeModal();
        toast("設定を削除しました");
      }),
  );
});
