import type { Project, WavResource } from "./chart";
import {
  ProjectStore,
  hashBlob,
  type ImportedFile,
  type StoredProject,
} from "./storage";
import { safeAssetPath } from "./import-export";
export const LIBRARY_PREFIX = "[音源ライブラリ] ";
export interface SoundCollection {
  kind: "sound-library";
  version: 1;
  name: string;
  sourceTitle: string;
  tags: string[];
  categories: string[];
  resources: WavResource[];
  files: ImportedFile[];
}
export interface LibraryUIHost {
  show(title: string, html: string): void;
  close(): void;
  getCurrent(): { project: Project; files: ImportedFile[] };
  addCollection(collection: {
    name: string;
    resources: WavResource[];
    files: ImportedFile[];
  }): Promise<void>;
  toast(message: string): void;
  error(error: unknown): void;
}
export function isLibraryRecord(record: { name: string }): boolean {
  return record.name.startsWith(LIBRARY_PREFIX);
}
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const text = (value: unknown, label: string, max: number): string => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new Error(`${label} が不正です。`);
  return value;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("ライブラリ形式が不正です。");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new Error("ライブラリ形式が不正です。");
  return value as Record<string, unknown>;
}
/** Projects/credentials are never serialized into a collection; only this explicit projection is saved. */
export function validateSoundCollection(
  data: unknown,
  files: ImportedFile[],
): SoundCollection {
  const d = object(data);
  if (d.kind !== "sound-library" || d.version !== 1)
    throw new Error("未対応の音源ライブラリ形式です。");
  const name = text(d.name, "名前", 160).trim();
  if (!name) throw new Error("ライブラリ名を入力してください。");
  const sourceTitle = text(d.sourceTitle ?? "", "元の譜面名", 1024);
  const labels = (value: unknown, label: string) => {
    if (!Array.isArray(value) || value.length > 40)
      throw new Error(`${label} は40個以内にしてください。`);
    return [
      ...new Set(value.map((v) => text(v, label, 80).trim()).filter(Boolean)),
    ];
  };
  const tags = labels(d.tags ?? [], "タグ"),
    categories = labels(d.categories ?? [], "分類");
  if (!Array.isArray(files) || files.length > 10000)
    throw new Error("ファイル数が多すぎます。");
  let total = 0;
  const paths = new Map<string, ImportedFile>();
  const safeFiles = files.map((f) => {
    if (!f || typeof f !== "object" || !(f.blob instanceof Blob))
      throw new Error("音源ファイルが不正です。");
    const path = safeAssetPath(text(f.path, "ファイル名", 1024)),
      key = path.toLowerCase();
    if (paths.has(key)) throw new Error(`重複するファイル名: ${path}`);
    total += f.blob.size;
    if (f.blob.size > 150 * 1024 * 1024 || total > 500 * 1024 * 1024)
      throw new Error("ライブラリの容量上限を超えています。");
    const entry: ImportedFile = {
      path,
      name: path.split("/").at(-1)!,
      blob: f.blob,
      size: f.blob.size,
      type: typeof f.type === "string" ? f.type.slice(0, 200) : "",
      hash: typeof f.hash === "string" ? f.hash : "",
    };
    paths.set(key, entry);
    return entry;
  });
  if (
    !Array.isArray(d.resources) ||
    !d.resources.length ||
    d.resources.length > 1295
  )
    throw new Error("WAV 定義を1〜1295個選んでください。");
  const ids = new Set<string>();
  const resources = d.resources.map((value) => {
    const r = object(value),
      id = text(r.id, "WAV ID", 2).toUpperCase();
    if (!/^[0-9A-Z]{2}$/.test(id) || id === "00" || ids.has(id))
      throw new Error("WAV ID が不正または重複しています。");
    ids.add(id);
    const file = safeAssetPath(text(r.file, "音源パス", 1024));
    if (!paths.has(file.toLowerCase()))
      throw new Error(
        `音源が未読込です: ${file}。フォルダーを読み込んでから保存してください。`,
      );
    const out: WavResource = { id, file: paths.get(file.toLowerCase())!.path };
    if (r.label !== undefined) out.label = text(r.label, "ラベル", 1024);
    for (const [key, min, max] of [
      ["volume", 0, 100],
      ["pan", -100, 100],
      ["size", 0, 1000],
    ] as const)
      if (r[key] !== undefined) {
        if (
          typeof r[key] !== "number" ||
          !Number.isFinite(r[key]) ||
          r[key] < min ||
          r[key] > max
        )
          throw new Error(`${key} が不正です。`);
        out[key] = r[key];
      }
    return out;
  });
  return {
    kind: "sound-library",
    version: 1,
    name,
    sourceTitle,
    tags,
    categories,
    resources,
    files: safeFiles,
  };
}
/** Selection changes definitions only. ALL files, including licenses/readmes, remain attached. */
export function selectCollectionResources(
  collection: SoundCollection,
  ids: string[],
): SoundCollection {
  const wanted = new Set(ids);
  if (
    ids.length !== wanted.size ||
    ids.some((id) => !collection.resources.some((r) => r.id === id))
  )
    throw new Error("選択した音源がライブラリにありません。");
  if (!ids.length) throw new Error("音源を1つ以上選択してください。");
  return {
    ...collection,
    resources: collection.resources
      .filter((r) => wanted.has(r.id))
      .map((r) => ({ ...r })),
    files: [...collection.files],
  };
}
export function collectionMatches(
  collection: SoundCollection,
  query: string,
): boolean {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),
    haystack = [
      collection.name,
      collection.sourceTitle,
      ...collection.tags,
      ...collection.categories,
      ...collection.resources.flatMap((r) => [r.file, r.label || ""]),
    ]
      .join(" ")
      .toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}
export function createLibraryUI(
  host: LibraryUIHost,
  store = new ProjectStore(),
): { open(): Promise<void>; dialogClosed(): void; dispose(): void } {
  let active = false,
    generation = 0,
    busy = false,
    query = "",
    selected = "",
    collections: Array<{ record: StoredProject; collection: SoundCollection }> =
      [];
  const root = () => document.querySelector<HTMLElement>("#sound-library");
  const read = (id: string) =>
    (root()?.querySelector<HTMLInputElement>(`#${id}`)?.value || "").trim();
  const split = (value: string) =>
    value
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter(Boolean);
  const current = () => collections.find((c) => c.record.id === selected);
  const save = async (collection: SoundCollection, id?: string) => {
    const { files, ...data } = collection;
    return store.save({
      id,
      name: LIBRARY_PREFIX + collection.name,
      data,
      files,
    });
  };
  async function refresh() {
    const token = generation,
      list = await store.list(),
      loaded: Array<{ record: StoredProject; collection: SoundCollection }> =
        [];
    for (const summary of list.filter(isLibraryRecord)) {
      const record = await store.load(summary.id);
      if (!record) continue;
      try {
        loaded.push({
          record,
          collection: validateSoundCollection(record.data, record.files),
        });
      } catch (error) {
        host.error(error);
      }
    }
    if (!active || generation !== token) return;
    collections = loaded;
    if (!collections.some((c) => c.record.id === selected))
      selected = collections[0]?.record.id || "";
    render();
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    root()
      ?.querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
    try {
      await action();
    } catch (error) {
      host.error(error);
    } finally {
      busy = false;
      if (active && root()) render();
    }
  }
  function render() {
    if (!active) return;
    const item = current(),
      filtered = collections.filter((c) =>
        collectionMatches(c.collection, query),
      );
    host.show(
      "音源ライブラリ",
      `<div id="sound-library"><p class="help">このブラウザー内だけに保存します。別の譜面にも音源セットを再利用できます。取り込み時はライセンス・README を含む全ファイルを保持します。</p><section class="card"><h3>現在の WAV バンクを保存</h3><label>名前<input id="library-new-name" maxlength="160" value="${esc(host.getCurrent().project.metadata.title || "新しい音源セット")}"></label><label>タグ（カンマ区切り）<input id="library-new-tags" placeholder="acoustic, jazz, cymbal"></label><label>分類（カンマ区切り）<input id="library-new-categories" placeholder="ドラム, 生音"></label><button id="library-save">現在の音源セットをローカル保存</button></section><hr><label>名前・タグ・分類で検索<input id="library-search" value="${esc(query)}" placeholder="例: jazz cymbal"></label><div style="display:grid;grid-template-columns:minmax(150px,1fr) minmax(220px,2fr);gap:16px"><div>${filtered.length ? filtered.map((c) => `<button type="button" data-library-id="${esc(c.record.id)}" style="display:block;width:100%;text-align:left;margin:5px 0" class="${c.record.id === selected ? "active" : ""}"><strong>${esc(c.collection.name)}</strong><br><small>${c.collection.resources.length} WAV · ${esc([...c.collection.categories, ...c.collection.tags].join(" / "))}</small></button>`).join("") : "<p>保存済みセットがありません。</p>"}</div><section>${item ? `<label>セット名<input id="library-edit-name" maxlength="160" value="${esc(item.collection.name)}"></label><label>タグ<input id="library-edit-tags" value="${esc(item.collection.tags.join(", "))}"></label><label>分類<input id="library-edit-categories" value="${esc(item.collection.categories.join(", "))}"></label><p class="help">元の譜面: ${esc(item.collection.sourceTitle)} · 全 ${item.collection.files.length} ファイル</p><button id="library-rename">名前・タグ・分類を更新</button> <button id="library-delete">セットを削除</button><div style="max-height:260px;overflow:auto;margin:12px 0">${item.collection.resources.map((r) => `<label style="display:block"><input type="checkbox" data-library-resource="${esc(r.id)}" checked> ${esc(r.id)} · ${esc(r.label || r.file)}</label>`).join("")}</div><button id="library-import">選択音源を現在の譜面へ</button> <button id="library-import-all">全部取り込む</button>` : "<p>セットを選択してください。</p>"}</section></div></div>`,
    );
    const el = root();
    if (!el) return;
    el.querySelector<HTMLInputElement>("#library-search")!.oninput = (
      event,
    ) => {
      query = (event.target as HTMLInputElement).value;
      render();
      const input = root()?.querySelector<HTMLInputElement>("#library-search");
      input?.focus();
      input?.setSelectionRange(query.length, query.length);
    };
    el.querySelectorAll<HTMLButtonElement>("[data-library-id]").forEach(
      (button) =>
        (button.onclick = () => {
          selected = button.dataset.libraryId!;
          render();
        }),
    );
    el.querySelector<HTMLButtonElement>("#library-save")!.onclick = () => {
      const name = read("library-new-name"),
        tags = split(read("library-new-tags")),
        categories = split(read("library-new-categories")),
        snapshot = host.getCurrent();
      void run(async () => {
        const collection = validateSoundCollection(
          {
            kind: "sound-library",
            version: 1,
            name,
            sourceTitle: snapshot.project.metadata.title,
            tags,
            categories,
            resources: Object.values(snapshot.project.resources),
          },
          snapshot.files,
        );
        for (const file of collection.files)
          file.hash = await hashBlob(file.blob);
        const record = await save(collection);
        selected = record.id;
        host.toast("音源セットをこのブラウザーに保存しました。");
        await refresh();
      });
    };
    const rename = el.querySelector<HTMLButtonElement>("#library-rename");
    if (rename)
      rename.onclick = () => {
        const item = current();
        if (!item) return;
        const data = {
          ...item.collection,
          name: read("library-edit-name"),
          tags: split(read("library-edit-tags")),
          categories: split(read("library-edit-categories")),
        };
        void run(async () => {
          await save(
            validateSoundCollection(data, item.collection.files),
            item.record.id,
          );
          host.toast("名前・タグ・分類を更新しました。");
          await refresh();
        });
      };
    const remove = el.querySelector<HTMLButtonElement>("#library-delete");
    if (remove)
      remove.onclick = () => {
        const item = current();
        if (
          !item ||
          !window.confirm(
            `「${item.collection.name}」をローカルライブラリから削除しますか？現在の譜面は変更されません。`,
          )
        )
          return;
        void run(async () => {
          await store.delete(item.record.id);
          selected = "";
          host.toast("ライブラリセットを削除しました。");
          await refresh();
        });
      };
    const importCollection = (all: boolean) => {
      const token = generation,
        item = current();
      if (!item) return;
      const ids = all
        ? item.collection.resources.map((r) => r.id)
        : [
            ...root()!.querySelectorAll<HTMLInputElement>(
              "[data-library-resource]:checked",
            ),
          ].map((el) => el.dataset.libraryResource!);
      void run(async () => {
        const choice = selectCollectionResources(item.collection, ids);
        await host.addCollection({
          name: choice.name,
          resources: choice.resources,
          files: choice.files,
        });
        host.toast(
          `${choice.resources.length} 音源を取り込みました（ライセンス同梱）。`,
        );
        if (active && generation === token) {
          active = false;
          generation++;
          host.close();
        }
      });
    };
    el.querySelector<HTMLButtonElement>("#library-import")?.addEventListener(
      "click",
      () => importCollection(false),
    );
    el.querySelector<HTMLButtonElement>(
      "#library-import-all",
    )?.addEventListener("click", () => importCollection(true));
    if (busy)
      el.querySelectorAll<HTMLButtonElement>("button").forEach(
        (b) => (b.disabled = true),
      );
  }
  return {
    async open() {
      active = true;
      generation++;
      host.show(
        "音源ライブラリ",
        '<div id="sound-library"><p>ローカルライブラリを読み込み中…</p></div>',
      );
      try {
        await refresh();
      } catch (error) {
        host.error(error);
        if (active) render();
      }
    },
    dialogClosed() {
      active = false;
      generation++;
    },
    dispose() {
      active = false;
      generation++;
    },
  };
}
