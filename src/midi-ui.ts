import {
  MidiInputController,
  type MidiHit,
  type MidiMessage,
} from "./midi-input";
import {
  createDefaultMidiProfile,
  loadMidiProfiles,
  saveMidiProfiles,
  importMidiProfiles,
  exportMidiProfiles,
  validateMidiProfile,
  calibrateMidiPedal,
  type MidiProfile,
} from "./midi-profiles";
export interface MidiUIHost {
  show: (title: string, html: string) => void;
  close: () => void;
  onHit: (hit: MidiHit, record: boolean) => void;
  toast: (message: string) => void;
  onArmed?: (armed: boolean) => void;
}
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** A session controller lives outside the dialog; closing it does not silently stop connected MIDI. */
export function createMidiUI(host: MidiUIHost): {
  open: () => void;
  dialogClosed: () => void;
  dispose: () => void;
} {
  let profiles: MidiProfile[] = [];
  let selected = "";
  let inputId = "";
  let armed = false;
  const setArmed = (value: boolean) => {
    armed = value;
    host.onArmed?.(value);
  };
  let last: MidiMessage | undefined;
  let openValue: number | undefined;
  let status = "未接続。接続ボタンで MIDI 権限を要求します。";
  try {
    profiles = loadMidiProfiles();
    selected = profiles[0]?.id ?? "";
  } catch (e) {
    host.toast(String(e));
  }
  const root = () => document.querySelector<HTMLElement>("#midi-editor");
  const controller = new MidiInputController({
    onHit: (h) => host.onHit(h, armed),
    onMessage: (m) => {
      last = m;
      const el = root()?.querySelector("#midi-monitor");
      if (el)
        el.textContent = `${m.inputId} · CH ${m.channel} · ${m.kind} ${m.number} = ${m.value}`;
    },
    onDevices: () => {
      if (inputId && !controller.devices.some((d) => d.portId === inputId)) {
        inputId = "";
        setArmed(false);
        status =
          "切断されました。再接続後に入力とプロファイルを再確認してください。";
      }
      if (root()) render();
    },
    onError: (s) => {
      status = s;
      host.toast(s);
      if (root()) render();
    },
  });
  const observer = new MutationObserver(() => {
    if (!root() && controller.isLearning) controller.cancelLearning();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const current = () => profiles.find((p) => p.id === selected);
  const save = () => saveMidiProfiles(profiles);
  function bind() {
    last = undefined;
    openValue = undefined;
    controller.cancelLearning();
    if (inputId) controller.bind(inputId, current() ?? null);
    setArmed(false);
  }
  function render() {
    const p = current();
    host.show(
      "電子ドラム / MIDI 入力",
      `<div id="midi-editor"><p class="note-box">機器・演奏モード別に保存します。CH は 1〜16。名前が同じ機器も入力ポート ID で区別し、自動で別機器へ再割り当てしません。実機動作は未検証です。</p><div class="row"><button data-act="connect">MIDI に接続</button><button data-act="disconnect">切断</button></div><p id="midi-status">${esc(status)}</p><label class="stack">入力機器<select id="midi-device"><option value="">選択してください</option>${controller.devices.map((d) => `<option value="${esc(d.portId)}" ${inputId === d.portId ? "selected" : ""}>${esc(d.name)} — ${esc(d.portId)}</option>`).join("")}</select></label><label class="stack">機器 / モード プロファイル<select id="midi-profile"><option value="">選択してください</option>${profiles.map((q) => `<option value="${esc(q.id)}" ${q.id === selected ? "selected" : ""}>${esc(q.name)} / ${esc(q.mode)}</option>`).join("")}</select></label><div class="row"><button data-act="new">選択機器の設定を新規作成</button><button data-act="clone">別モードに複製</button><button data-act="delete">削除</button></div><label class="check-row"><input id="midi-arm" type="checkbox" ${armed ? "checked" : ""}>MIDI 録音を有効化（未チェック時は試聴のみ）</label><p id="midi-monitor" class="small muted">パッド / ペダルを操作して入力を確認</p>${p ? `<label class="stack">名前<input id="midi-name" value="${esc(p.name)}"></label><label class="stack">モード名<input id="midi-mode" value="${esc(p.mode)}"></label><label class="stack">MIDI 入力遅延補正 (ms)<input id="midi-latency" type="number" min="-1000" max="1000" step="1" value="${p.latencyMs ?? 0}"></label><p class="small muted">正数は入力の遅れを補正し記録位置を早めます。音声出力の遅延とは別設定です。</p><h3>パッドを叩いて学習</h3><div class="row"><label>ゾーン名<input id="midi-zone" value="HH bow"></label><label>DTX CH<select id="midi-target">${["11", "18", "12", "13", "14", "15", "17", "1A", "16", "19", "1B", "1C"].map((c) => `<option>${c}</option>`).join("")}</select></label><label>WAV ID<input id="midi-wav" value="01" maxlength="2" size="3"></label></div><label class="check-row"><input type="checkbox" id="midi-hh">この打面はペダル開閉で HH 11 / 18 を切り替える</label><div class="row"><button data-act="learn-note">次の打撃を学習</button><button data-act="cancel-learn">学習終了</button></div><p class="small muted">学習中は全機器の録音 / 試聴を停止します。同じ CH + ノートは置換し、別ノートの bow / edge / bell は残します。</p><h3>HH ペダル</h3><div class="row"><button data-act="learn-cc">次の CC をペダルに学習</button><button data-act="open">現在 CC を完全オープンとして記憶</button><button data-act="closed">現在 CC を完全クローズとして校正</button></div><p class="small muted">CC 4 は初期候補のみ。機種の実際の CC を学習してください。CC のみで足音を鳴らす設定は既定 OFF。半開きは独立 DTX レーンではなく 11 / 18 と WAV 音色で表現します。</p><h3>全割り当て / 詳細設定</h3><p class="small muted">channel: 1〜16 / note: 0〜127 / zone: 打面名。target は DTX CH と WAV ID。hiHat に closed / open / halfOpen を設定可。pedal の invert / openMax / closedMin / hysteresis / staleMs を調整可。footClose / splash は必要時のみ追加してください。適用前の JSON は学習操作で上書きされるため先に適用してください。</p><textarea id="midi-json" rows="17" style="width:100%;font-family:monospace">${esc(JSON.stringify(p, null, 2))}</textarea><button data-act="apply">名前 / モード / 詳細設定を適用して保存</button>` : ""}<hr><div class="row"><button data-act="export">全プロファイルを JSON 保存</button><label>JSON 読込<input id="midi-import-profiles" type="file" accept=".json,application/json"></label><button data-act="close">閉じる（MIDI 接続は維持）</button></div></div>`,
    );
    const el = root()!;
    el.querySelector("#midi-device")!.addEventListener("change", (e) => {
      const previous = inputId;
      if (previous) controller.bind(previous, null);
      inputId = (e.target as HTMLSelectElement).value;
      bind();
      status =
        "入力を選択しました。プロファイルの CH / ノート / WAV を確認してください。";
      render();
    });
    el.querySelector("#midi-profile")!.addEventListener("change", (e) => {
      selected = (e.target as HTMLSelectElement).value;
      bind();
      render();
    });
    el.querySelector("#midi-arm")!.addEventListener("change", (e) => {
      setArmed((e.target as HTMLInputElement).checked);
      if (armed && (!inputId || !current() || controller.isLearning)) {
        setArmed(false);
        (e.target as HTMLInputElement).checked = false;
        host.toast("接続・機器・設定を選び、学習を終了してください。");
      }
    });
    el.querySelector("#midi-import-profiles")!.addEventListener(
      "change",
      async (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        try {
          if (f.size > 1_000_000)
            throw new Error("設定ファイルが大きすぎます。");
          const imported = importMidiProfiles(await f.text());
          for (const q of imported) {
            const i = profiles.findIndex((p) => p.id === q.id);
            if (i >= 0) profiles[i] = q;
            else profiles.push(q);
          }
          save();
          selected = imported[0]?.id ?? selected;
          bind();
          render();
        } catch (error) {
          host.toast(String(error));
        }
      },
    );
    el.querySelectorAll<HTMLButtonElement>("[data-act]").forEach(
      (b) =>
        (b.onclick = () => {
          void action(b.dataset.act!).catch((e) => host.toast(String(e)));
        }),
    );
  }
  async function action(act: string) {
    const p = current();
    const value = (id: string) =>
      root()!.querySelector<HTMLInputElement>(`#${id}`)!.value;
    if (act === "connect") {
      status = (await controller.connect())
        ? "接続済み。入力機器を選んでください。"
        : "接続できませんでした。ブラウザの権限を確認してください。";
      render();
    }
    if (act === "disconnect") {
      controller.disconnect();
      inputId = "";
      setArmed(false);
      status = "切断しました。";
      render();
    }
    if (act === "close") {
      controller.cancelLearning();
      host.close();
    }
    if (act === "new") {
      const device = controller.devices.find((d) => d.portId === inputId);
      if (!device) throw new Error("先に接続して入力機器を選んでください。");
      const q = createDefaultMidiProfile(device);
      profiles.push(q);
      selected = q.id;
      save();
      bind();
      render();
    }
    if (act === "clone" && p) {
      const q = structuredClone(p);
      q.id = crypto.randomUUID();
      q.mode += " コピー";
      profiles.push(q);
      selected = q.id;
      save();
      bind();
      render();
    }
    if (act === "delete" && p) {
      profiles = profiles.filter((q) => q.id !== p.id);
      selected = profiles[0]?.id ?? "";
      save();
      bind();
      render();
    }
    if (act === "apply" && p) {
      const q = validateMidiProfile({
        ...JSON.parse(value("midi-json")),
        id: p.id,
        name: value("midi-name"),
        mode: value("midi-mode"),
        latencyMs: Number(value("midi-latency")),
      });
      profiles[profiles.indexOf(p)] = q;
      save();
      bind();
      status = "保存しました。録音は安全のため OFF に戻しました。";
      render();
    }
    if (act === "cancel-learn") {
      controller.cancelLearning();
      status = "学習を終了しました。";
      render();
    }
    if ((act === "learn-note" || act === "learn-cc") && p) {
      if (!inputId) throw new Error("入力機器を選択してください。");
      setArmed(false);
      const zone = value("midi-zone"),
        channel = value("midi-target"),
        wav = value("midi-wav").toUpperCase(),
        hh = root()!.querySelector<HTMLInputElement>("#midi-hh")!.checked;
      controller.setLearning({
        inputId,
        kind: act === "learn-note" ? "note" : "cc",
        onLearn: (m) => {
          try {
            const q = structuredClone(p);
            if (m.kind === "note") {
              q.mappings = q.mappings.filter(
                (n) => n.channel !== m.channel || n.note !== m.number,
              );
              q.mappings.push({
                id: crypto.randomUUID(),
                channel: m.channel,
                note: m.number,
                zone,
                target: { channel, value: wav },
                ...(hh
                  ? {
                      hiHat: {
                        closed: { channel: "11", value: wav },
                        open: { channel: "18", value: wav },
                      },
                    }
                  : {}),
              });
            } else if (q.pedal) {
              q.pedal.channel = m.channel;
              q.pedal.cc = m.number;
            }
            profiles[profiles.indexOf(p)] = validateMidiProfile(q);
            save();
            bind();
            status = `学習しました: CH ${m.channel} / ${m.kind} ${m.number}`;
            render();
          } catch (error) {
            controller.cancelLearning();
            host.toast(String(error));
          }
        },
      });
      status = "学習待ち。入力しても譜面には記録しません。";
      render();
    }
    if ((act === "open" || act === "closed") && p?.pedal) {
      if (
        !last ||
        last.inputId !== inputId ||
        last.kind !== "cc" ||
        last.channel !== p.pedal.channel ||
        last.number !== p.pedal.cc
      )
        throw new Error("選択機器の設定済みペダル CC を操作してください。");
      if (act === "open") {
        openValue = last.value;
        status = `オープン値 ${openValue} を記憶しました。次に完全に閉じてください。`;
      } else {
        if (openValue === undefined)
          throw new Error("先にオープン値を記憶してください。");
        p.pedal = calibrateMidiPedal(p.pedal, openValue, last.value);
        openValue = undefined;
        save();
        bind();
        status = "ペダル方向・しきい値を校正して保存しました。";
      }
      render();
    }
    if (act === "export") {
      const url = URL.createObjectURL(
        new Blob([exportMidiProfiles(profiles)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "dtx-midi-profiles.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  return {
    open: render,
    dialogClosed: () => controller.cancelLearning(),
    dispose: () => {
      observer.disconnect();
      setArmed(false);
      controller.disconnect();
    },
  };
}
