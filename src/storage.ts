/** Local-only IndexedDB storage. Nothing is uploaded. */
export interface ImportedFile {
  path: string;
  name: string;
  blob: Blob;
  hash: string;
  size: number;
  type: string;
}
export interface ImportResult {
  files: ImportedFile[];
  warnings: string[];
  pathMap: Record<string, string>;
  ambiguousPaths: string[];
}
export interface StoredProject<T = unknown> {
  id: string;
  name: string;
  data: T;
  files: ImportedFile[];
  updatedAt: number;
  createdAt: number;
}
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  fileCount: number;
}
export function normalizePath(input: string): string {
  const value = input.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !value ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    /[\x00-\x1f]/.test(value)
  )
    throw new Error(`Unsafe file path: ${input}`);
  const parts = value.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".."))
    throw new Error(`Parent traversal is not allowed: ${input}`);
  if (!parts.length) throw new Error("Empty file path");
  return parts.join("/").normalize("NFC");
}
export async function hashBlob(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
/** Keeps folder-relative paths. Identical duplicates are skipped, conflicts renamed. */
export async function importFiles(
  input: File[] | FileList,
  existing: ImportedFile[] = [],
): Promise<ImportResult> {
  const pathMap: Record<string, string> = {},
    sourceHashes = new Map<string, string>(),
    ambiguous = new Set<string>();
  const recordMapping = (source: string, path: string, hash: string) => {
    const key = source.toLowerCase();
    if (sourceHashes.has(key) && sourceHashes.get(key) !== hash) {
      ambiguous.add(key);
      for (const original of Object.keys(pathMap))
        if (original.toLowerCase() === key) delete pathMap[original];
    } else if (!ambiguous.has(key)) {
      sourceHashes.set(key, hash);
      pathMap[source] = path;
    }
  };
  const files: ImportedFile[] = [],
    warnings: string[] = [],
    paths = new Map(existing.map((f) => [f.path.toLocaleLowerCase(), f]));
  const raw = Array.from(input);
  const folderPaths = raw.map((f) => f.webkitRelativePath).filter(Boolean);
  const roots = new Set(folderPaths.map((p) => p.split("/")[0]));
  const stripRoot = folderPaths.length === raw.length && roots.size === 1;
  for (const file of raw) {
    try {
      let path = normalizePath(file.webkitRelativePath || file.name);
      if (stripRoot) path = path.split("/").slice(1).join("/");
      const hash = await hashBlob(file),
        original = path;
      let n = 2;
      const conflict = paths.get(path.toLocaleLowerCase());
      if (conflict?.hash === hash) {
        warnings.push(`Skipped identical duplicate: ${path}`);
        recordMapping(original, conflict.path, hash);
        continue;
      }
      while (paths.has(path.toLocaleLowerCase())) {
        const dot = original.lastIndexOf("."),
          slash = original.lastIndexOf("/");
        path =
          dot > slash
            ? `${original.slice(0, dot)} (${n++})${original.slice(dot)}`
            : `${original} (${n++})`;
      }
      if (path !== original)
        warnings.push(
          `Renamed conflicting file ${original} → ${path}; check chart references.`,
        );
      const entry = {
        path,
        name: path.split("/").at(-1)!,
        blob: file,
        hash,
        size: file.size,
        type: file.type,
      };
      paths.set(path.toLocaleLowerCase(), entry);
      files.push(entry);
      recordMapping(original, path, hash);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { files, warnings, pathMap, ambiguousPaths: [...ambiguous] };
}
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(r.error || new Error("Local storage request failed"));
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error || new Error("Local storage transaction aborted"));
    tx.onerror = () =>
      reject(tx.error || new Error("Local storage transaction failed"));
  });
}
export class ProjectStore {
  private database?: Promise<IDBDatabase>;
  constructor(private name = "dtx-workbench-local-v1") {}
  private open(): Promise<IDBDatabase> {
    return (this.database ||= new Promise((resolve, reject) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("projects"))
          db.createObjectStore("projects", { keyPath: "id" });
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          this.database = undefined;
        };
        resolve(r.result);
      };
      r.onerror = () => {
        this.database = undefined;
        reject(r.error || new Error("IndexedDB unavailable"));
      };
      r.onblocked = () => {
        this.database = undefined;
        reject(new Error("Close other editor tabs to upgrade local storage."));
      };
    }));
  }
  async save<T>(project: {
    id?: string;
    name: string;
    data: T;
    files?: ImportedFile[];
    createdAt?: number;
  }): Promise<StoredProject<T>> {
    const id = project.id || crypto.randomUUID(),
      db = await this.open();
    const previous = project.id ? await this.load<T>(project.id) : undefined;
    const record: StoredProject<T> = {
      id,
      name: project.name,
      data: project.data,
      files: project.files ?? previous?.files ?? [],
      updatedAt: Date.now(),
      createdAt: project.createdAt ?? previous?.createdAt ?? Date.now(),
    };
    const tx = db.transaction("projects", "readwrite"),
      done = completed(tx);
    tx.objectStore("projects").put(record);
    await done;
    return record;
  }
  async load<T = unknown>(id: string): Promise<StoredProject<T> | undefined> {
    const db = await this.open(),
      tx = db.transaction("projects", "readonly");
    return request(tx.objectStore("projects").get(id));
  }
  async list(): Promise<ProjectSummary[]> {
    const db = await this.open(),
      tx = db.transaction("projects", "readonly"),
      all: StoredProject[] = await request(tx.objectStore("projects").getAll());
    return all
      .map(({ id, name, updatedAt, createdAt, files }) => ({
        id,
        name,
        updatedAt,
        createdAt,
        fileCount: files.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async delete(id: string): Promise<void> {
    const db = await this.open(),
      tx = db.transaction("projects", "readwrite"),
      done = completed(tx);
    tx.objectStore("projects").delete(id);
    await done;
  }
  async close(): Promise<void> {
    if (this.database) (await this.database).close();
    this.database = undefined;
  }
}
export async function storageEstimate(): Promise<{
  usage?: number;
  quota?: number;
  persistent: boolean;
}> {
  const estimate = (await navigator.storage?.estimate?.()) || {};
  return {
    ...estimate,
    persistent: (await navigator.storage?.persisted?.()) || false,
  };
}
