/** Five-fret presentation/editing model, independent of the DOM/canvas. */
import {
  STRING_CHANNELS,
  stringChannel,
  beatToBar,
  type Project,
  type Note,
  type StringChannel,
} from "./chart.js";
export type StringInstrument = "guitar" | "bass";
export const FRET_DESCRIPTORS = [
  { index: 0, key: "R", label: "赤", color: "#ff7c85" },
  { index: 1, key: "G", label: "緑", color: "#8bd79b" },
  { index: 2, key: "B", label: "青", color: "#82b6ff" },
  { index: 3, key: "Y", label: "黄", color: "#f2d572" },
  { index: 4, key: "P", label: "紫", color: "#cd9bea" },
] as const;
export const STRING_INSTRUMENTS = {
  guitar: { label: "ギター", open: "20", wail: "28", hold: "2C", voice: "BA" },
  bass: { label: "ベース", open: "A0", wail: "A8", hold: "2D", voice: "BB" },
} as const;
export const STRING_VIEW_LANES = [
  { id: "voice", label: "音源" },
  ...FRET_DESCRIPTORS.map((f) => ({
    id: f.key,
    label: f.label,
    color: f.color,
  })),
  { id: "open", label: "OPEN" },
  { id: "wail", label: "WAIL" },
  { id: "hold", label: "HOLD" },
];
function normalize(frets: readonly number[]): number[] {
  if (frets.some((f) => !Number.isInteger(f) || f < 0 || f > 4))
    throw new Error("フレットは R/G/B/Y/P（0〜4）で指定してください。");
  return [...new Set(frets)].sort((a, b) => a - b);
}
export function channelForFrets(
  instrument: StringInstrument,
  frets: readonly number[],
): string {
  const normalized = normalize(frets);
  const channel = STRING_CHANNELS.find(
    (c) =>
      c.instrument === instrument &&
      (normalized.length ? c.kind === "note" : c.kind === "open") &&
      c.frets.length === normalized.length &&
      c.frets.every((f, i) => f === normalized[i]),
  );
  if (!channel)
    throw new Error(
      "このフレット組合せに対応する DTX チャンネルがありません。",
    );
  return channel.channel;
}
export interface StringNoteView {
  id: string;
  beat: number;
  instrument: StringInstrument;
  frets: readonly number[];
  kind: StringChannel["kind"];
  channel: string;
  value: string;
  label: string;
}
/** One chord remains one WAV event; projecting to five fret columns never duplicates sound. */
export function describeStringNote(note: Note): StringNoteView | undefined {
  const c = stringChannel(note.channel);
  if (!c) return undefined;
  return {
    id: note.id,
    beat: note.beat,
    instrument: c.instrument,
    frets: [...c.frets],
    kind: c.kind,
    channel: note.channel,
    value: note.value,
    label:
      c.kind === "note"
        ? c.frets.map((i) => FRET_DESCRIPTORS[i].key).join("")
        : c.kind.toUpperCase(),
  };
}
export function projectStringNotes(
  project: Project,
  instrument: StringInstrument,
): StringNoteView[] {
  return project.notes.flatMap((n) => {
    const view = describeStringNote(n);
    return view?.instrument === instrument ? [view] : [];
  });
}
function clone(project: Project): Project {
  if (project.readOnlyReason) throw new Error(project.readOnlyReason);
  return structuredClone(project);
}
function playable(note: Note): StringChannel {
  const c = stringChannel(note.channel);
  if (!c || (c.kind !== "note" && c.kind !== "open"))
    throw new Error(
      "フレット編集にはギター / ベースの通常ノートまたは OPEN を選択してください。WAIL / HOLD は専用操作で編集します。",
    );
  return c;
}
/** Preserve voice ID, note ID and position. Clearing the final fret creates an OPEN note. */
export function toggleFret(
  project: Project,
  noteId: string,
  fretIndex: number,
): Project {
  normalize([fretIndex]);
  const note = project.notes.find((n) => n.id === noteId);
  if (!note) throw new Error("選択ノートが見つかりません。");
  const c = playable(note);
  return setStringFrets(
    project,
    [noteId],
    c.frets.includes(fretIndex)
      ? c.frets.filter((f) => f !== fretIndex)
      : [...c.frets, fretIndex],
  );
}
/** Apply one chord shape to selected guitar/bass notes, retaining each instrument and voice. */
export function setStringFrets(
  project: Project,
  notes: Iterable<string | Note>,
  frets: readonly number[],
): Project {
  const normalized = normalize(frets),
    ids = new Set([...notes].map((n) => (typeof n === "string" ? n : n.id))),
    result = clone(project);
  for (const id of ids) {
    const note = result.notes.find((n) => n.id === id);
    if (!note) throw new Error(`ノート ${id} が見つかりません。`);
    const c = playable(note);
    note.channel = channelForFrets(c.instrument, normalized);
    delete note.lane;
  }
  return result;
}
/** Draw/update a single chord at a beat without making five independent audio hits. */
export function setStringChord(
  project: Project,
  instrument: StringInstrument,
  beat: number,
  frets: readonly number[],
  value: string,
  noteId?: string,
): Project {
  if (!Number.isFinite(beat) || beat < 0)
    throw new Error("拍位置は 0 以上にしてください。");
  if (!/^[0-9A-Z]{2}$/.test(value) || value === "00")
    throw new Error("音源 ID は 01〜ZZ を指定してください。");
  const channel = channelForFrets(instrument, frets),
    result = clone(project);
  const at = result.notes.filter(
    (n) =>
      Math.abs(n.beat - beat) < 1e-9 &&
      stringChannel(n.channel)?.instrument === instrument &&
      ["note", "open"].includes(stringChannel(n.channel)!.kind),
  );
  if (at.length > 1)
    throw new Error(
      "同じ時刻に複数の音源ノートがあります。ノートを選択して個別にフレットを編集してください。",
    );
  if (at.length) {
    at[0].channel = channel;
    at[0].value = value;
    delete at[0].lane;
  } else {
    let id = noteId || `chord-${instrument}-${beat}`;
    let suffix = 1;
    while (result.notes.some((n) => n.id === id))
      id = `${noteId || `chord-${instrument}-${beat}`}-${suffix++}`;
    result.notes.push({ id, beat, channel, value });
    result.notes.sort((a, b) => a.beat - b.beat);
  }
  result.barCount = Math.max(result.barCount, beatToBar(result, beat).bar + 1);
  return result;
}
