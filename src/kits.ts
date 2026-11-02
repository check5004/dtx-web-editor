/** Bundled MIDI-rendered percussion. Sound recordings are MIT, not app-generated synths. */
import type { ImportedFile } from "./storage";
export type KitId = "standard" | "electronic" | "jazz";
export interface KitSound {
  lane: string;
  filename: string;
  url: string;
  midiNote: number;
  sha256: string;
  bytes: number;
}
export interface KitPreset {
  id: KitId;
  name: string;
  description: string;
  program: number;
  sounds: KitSound[];
  bytes: number;
}
export interface LoadedKit {
  preset: KitPreset;
  files: ImportedFile[];
  laneFiles: Record<string, string>;
}
const sourceSamples: Record<
  KitId,
  Array<{
    lane: string;
    file: string;
    midiNote: number;
    sha256: string;
    bytes: number;
  }>
> = {
  standard: [
    {
      lane: "BD",
      file: "standard/BD.wav",
      midiNote: 36,
      sha256:
        "48c1931b83b39300883b83341464e6d0dbab03aed43375b014483918341189f2",
      bytes: 29368,
    },
    {
      lane: "LB",
      file: "standard/LB.wav",
      midiNote: 35,
      sha256:
        "f4efe33383bed6c111c1f8f3e1e1aebbf37b55d3a3b1e42b90e81e40a5f2f349",
      bytes: 30880,
    },
    {
      lane: "SN",
      file: "standard/SN.wav",
      midiNote: 38,
      sha256:
        "8c1caa9988f02acbe74c7f69325f22bd36fe6eff99a0af9155e010541fed8714",
      bytes: 42912,
    },
    {
      lane: "HH",
      file: "standard/HH.wav",
      midiNote: 42,
      sha256:
        "9b68e4142a132017514fa01f94ed6dbd444e9e37fb9d3057865130f50649bfc9",
      bytes: 47466,
    },
    {
      lane: "OH",
      file: "standard/OH.wav",
      midiNote: 46,
      sha256:
        "67ad8dc3d478dd676eccca6f1f364a4f203cb4727b057ae05c7f740bdaf50d34",
      bytes: 262558,
    },
    {
      lane: "LP",
      file: "standard/LP.wav",
      midiNote: 44,
      sha256:
        "487ecc3f375064baa48a9a729e15f9f87da0a3fb7b3a1afdbf1ed8bd15787d1c",
      bytes: 34734,
    },
    {
      lane: "HT",
      file: "standard/HT.wav",
      midiNote: 50,
      sha256:
        "50adcfc5abc3d958a81d44db9596fa2024526c028194778b9d0b047dce068e11",
      bytes: 72232,
    },
    {
      lane: "LT",
      file: "standard/LT.wav",
      midiNote: 47,
      sha256:
        "2ba67e487a9631156893c5c48edfefc508a42dab70ee40a75d96a10865ebd4c9",
      bytes: 85074,
    },
    {
      lane: "FT",
      file: "standard/FT.wav",
      midiNote: 41,
      sha256:
        "2c0b68a18f5d367bfcafaa7ebc9429f64f23fc5649f200d29e14f1352f6ccb49",
      bytes: 92260,
    },
    {
      lane: "LC",
      file: "standard/LC.wav",
      midiNote: 57,
      sha256:
        "66eda47075d33fc02305c843e0bf21cf96d88fb331376e3b4e12f4021e9fb8f8",
      bytes: 411632,
    },
    {
      lane: "RC",
      file: "standard/RC.wav",
      midiNote: 49,
      sha256:
        "e344d2d4a97bfe2a5a890a98b0cfe79dbf641990110de2b66e7587637c965e3a",
      bytes: 620850,
    },
    {
      lane: "RD",
      file: "standard/RD.wav",
      midiNote: 51,
      sha256:
        "9481ab1cdc467474042c88a2a1a8175acf2933602e15bba306dcb0c75c27ce44",
      bytes: 199332,
    },
    {
      lane: "RB",
      file: "standard/RB.wav",
      midiNote: 53,
      sha256:
        "370283652e4e0b787e644fc053e194b530eac3f518b242ed6c6f85a627df7e71",
      bytes: 277042,
    },
  ],
  electronic: [
    {
      lane: "BD",
      file: "electronic/BD.wav",
      midiNote: 36,
      sha256:
        "4d60f6b65231bae06068e45b34ae6230d139ee13c3255f2847023d698745a17c",
      bytes: 30524,
    },
    {
      lane: "LB",
      file: "electronic/LB.wav",
      midiNote: 35,
      sha256:
        "e202fc93dfc506fb462badb610943b89f1378e4d21b38425f35bf9e0384ba0ba",
      bytes: 39104,
    },
    {
      lane: "SN",
      file: "electronic/SN.wav",
      midiNote: 38,
      sha256:
        "601edc702767cc554e2fead2f1257f6ce3ef67e7f6f34738d3fa6c7c820aa870",
      bytes: 66502,
    },
    {
      lane: "HH",
      file: "electronic/HH.wav",
      midiNote: 42,
      sha256:
        "8bdaddcee9044322c649b43f71436755a3f68dc6b374d85c7417c312244f9e10",
      bytes: 47310,
    },
    {
      lane: "OH",
      file: "electronic/OH.wav",
      midiNote: 46,
      sha256:
        "a7a8f8e525aef90b79c72db7554e0713209b28d06b94ede18387396d2a12e108",
      bytes: 261752,
    },
    {
      lane: "LP",
      file: "electronic/LP.wav",
      midiNote: 44,
      sha256:
        "d9dd12a191da2f9732fef66119c972835cf4d2cfb71f0bbbf3a6ea6edec55c35",
      bytes: 34766,
    },
    {
      lane: "HT",
      file: "electronic/HT.wav",
      midiNote: 50,
      sha256:
        "12c8a7dcb6735be838b97063a506f95d3cbd79b305f996598d278950c14085d1",
      bytes: 44120,
    },
    {
      lane: "LT",
      file: "electronic/LT.wav",
      midiNote: 47,
      sha256:
        "6baee407625981ee674c261ce0993e97c7a437333b010dc5a238eb8bda228dcc",
      bytes: 71002,
    },
    {
      lane: "FT",
      file: "electronic/FT.wav",
      midiNote: 41,
      sha256:
        "580b07bf0490484b64f60895c32fd1d731652cc4dff10b47c57ef1aee2856976",
      bytes: 98600,
    },
    {
      lane: "LC",
      file: "electronic/LC.wav",
      midiNote: 57,
      sha256:
        "5662be88dde2192543ed4e7bd3d4d44af4e9fd1c9d3b37f4909e80d8325bfd46",
      bytes: 443028,
    },
    {
      lane: "RC",
      file: "electronic/RC.wav",
      midiNote: 49,
      sha256:
        "527b1b84b47d0564587b52e41e904a1306db1a35341b2e3d7e995f63d5faa174",
      bytes: 658652,
    },
    {
      lane: "RD",
      file: "electronic/RD.wav",
      midiNote: 51,
      sha256:
        "b65e9d0f7fe0fdd4452aed96d6257480e5be93b0c9ba75fe7630dca14eac3ecd",
      bytes: 215500,
    },
    {
      lane: "RB",
      file: "electronic/RB.wav",
      midiNote: 53,
      sha256:
        "464541827a57d0bea74ad496ac56ede113438e7f9390a2cd75a20de80842c781",
      bytes: 280082,
    },
  ],
  jazz: [
    {
      lane: "BD",
      file: "jazz/BD.wav",
      midiNote: 36,
      sha256:
        "7367f3ec82ffad37eb3819d6ee80a4e818fd3605fec500ee596ceb81b5b3b86c",
      bytes: 38114,
    },
    {
      lane: "LB",
      file: "jazz/LB.wav",
      midiNote: 35,
      sha256:
        "973eff457c2c57df22d786f27533acf1e3ca9a7d38495ed53683996c159e5c9c",
      bytes: 40142,
    },
    {
      lane: "SN",
      file: "jazz/SN.wav",
      midiNote: 38,
      sha256:
        "10debd8cc317baed9295c04e6e7ba71909de98b2565ddae59caac417ec15e658",
      bytes: 35424,
    },
    {
      lane: "HH",
      file: "jazz/HH.wav",
      midiNote: 42,
      sha256:
        "8f5e4312661d132d4115e74914f26f05dedefab74b555a14eca0ca83d46c26fb",
      bytes: 57190,
    },
    {
      lane: "OH",
      file: "jazz/OH.wav",
      midiNote: 46,
      sha256:
        "afdd7c8364ae417c1e3c433beb39e1744ce52988e5d7c16a859f31ce4a1bbb32",
      bytes: 270704,
    },
    {
      lane: "LP",
      file: "jazz/LP.wav",
      midiNote: 44,
      sha256:
        "a9d3198bf4b4b998acef161afffcd49311bbe4cd98fc396fb5ba4977118004a4",
      bytes: 40614,
    },
    {
      lane: "HT",
      file: "jazz/HT.wav",
      midiNote: 50,
      sha256:
        "34306177901a9a8ea82ce45fb9ed35eb7012bfc79ed514d3b29313c5a328b593",
      bytes: 92934,
    },
    {
      lane: "LT",
      file: "jazz/LT.wav",
      midiNote: 47,
      sha256:
        "e44c5ae5fffef2d368db8dc9a995d1f14773ee4e287f379a39bae724a27cabb4",
      bytes: 93766,
    },
    {
      lane: "FT",
      file: "jazz/FT.wav",
      midiNote: 41,
      sha256:
        "f69b9096e2fa402c5f535afcf25706e6b1ff369848996fce496c2aa50c43b895",
      bytes: 92324,
    },
    {
      lane: "LC",
      file: "jazz/LC.wav",
      midiNote: 57,
      sha256:
        "d3441d0ca29c2d2235fb3a43478ec724c29e39c1496c2479046dd58d42acc6a6",
      bytes: 456210,
    },
    {
      lane: "RC",
      file: "jazz/RC.wav",
      midiNote: 49,
      sha256:
        "ac6ca34ba132da8ddfd6f6ad6c3a8b7901817d933477b1263e6e558c2b7ce892",
      bytes: 690096,
    },
    {
      lane: "RD",
      file: "jazz/RD.wav",
      midiNote: 51,
      sha256:
        "b7f669a9a2a7bef40e130676ce7302834bcffa2be193aaa7ea7378e4e48ba4ed",
      bytes: 224128,
    },
    {
      lane: "RB",
      file: "jazz/RB.wav",
      midiNote: 53,
      sha256:
        "87fb5d953c217c02a44d53a283e6cfa32c2a692e95229e783aa5df420c902edf",
      bytes: 289200,
    },
  ],
};
export const KIT_PRESETS: KitPreset[] = [
  {
    id: "standard",
    name: "Standard · 生ドラム",
    description: "FluidR3Mono の標準 GM ドラム。オーソドックスなキット。",
    program: 0,
  },
  {
    id: "electronic",
    name: "Electronic · 電子ドラム",
    description: "FluidR3Mono の Electronic キット。電子音楽向けの選択肢。",
    program: 24,
  },
  {
    id: "jazz",
    name: "Jazz · ジャズ",
    description:
      "FluidR3Mono の Jazz キット。標準キットとは異なる音色・バランス。",
    program: 32,
  },
].map((p) => ({
  ...p,
  id: p.id as KitId,
  sounds: sourceSamples[p.id as KitId].map((s) => ({
    lane: s.lane,
    filename: `kit/fluidr3/${s.file}`,
    url: `sounds/fluidr3/${s.file}`,
    midiNote: s.midiNote,
    sha256: s.sha256,
    bytes: s.bytes,
  })),
  bytes: sourceSamples[p.id as KitId].reduce((n, s) => n + s.bytes, 0),
}));
export const KIT_LICENSE_PATH = "kit/fluidr3/LICENSE.txt";
export const KIT_SOURCE_URL =
  "https://github.com/musescore/MuseScore/tree/45924076871483cb96b859cc374c5fbdbf76ba53/share/sound";
const digest = async (bytes: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
/** Loads only the explicitly selected kit. Returned license/manifest files MUST accompany export. */
export async function loadKit(
  id: KitId,
  options: {
    baseUrl?: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  } = {},
): Promise<LoadedKit> {
  const preset = KIT_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error("不明な内蔵ドラムキットです。");
  const fetcher = options.fetcher ?? fetch;
  const appBase =
    (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
      ?.BASE_URL ?? "./";
  const base = new URL(
    options.baseUrl ?? appBase,
    typeof document === "undefined" ? "https://localhost/" : document.baseURI,
  );
  const read = async (
    path: string,
    filename: string,
    expected?: { sha256: string; bytes: number },
  ): Promise<ImportedFile> => {
    const response = await fetcher(new URL(path, base), {
      signal: options.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok)
      throw new Error(
        `内蔵キットの読み込みに失敗しました (${response.status})。`,
      );
    const bytes = await response.arrayBuffer();
    const hash = await digest(bytes);
    if (
      expected &&
      (bytes.byteLength !== expected.bytes || hash !== expected.sha256)
    )
      throw new Error(
        "内蔵音源の整合性を確認できません。キットは適用されません。",
      );
    if (expected) {
      const header = new DataView(bytes);
      if (
        bytes.byteLength < 44 ||
        header.getUint32(0) !== 0x52494646 ||
        header.getUint32(8) !== 0x57415645
      )
        throw new Error("内蔵音源の WAV 形式が不正です。");
    }
    const type = filename.endsWith(".wav")
      ? "audio/wav"
      : filename.endsWith(".json")
        ? "application/json"
        : "text/plain";
    return {
      path: filename,
      name: filename.split("/").at(-1)!,
      blob: new Blob([bytes], { type }),
      hash,
      size: bytes.byteLength,
      type,
    };
  };
  // Fetch attribution as part of the same transaction; never return an unlicensed partial kit.
  const [sounds, license, provenance] = await Promise.all([
    Promise.all(preset.sounds.map((s) => read(s.url, s.filename, s))),
    read("sounds/fluidr3/LICENSE.txt", KIT_LICENSE_PATH),
    read("sounds/fluidr3/manifest.json", "kit/fluidr3/SOURCES.json"),
  ]);
  return {
    preset,
    files: [...sounds, license, provenance],
    laneFiles: Object.fromEntries(
      preset.sounds.map((s) => [s.lane, s.filename]),
    ),
  };
}
