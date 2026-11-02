import {
  analyzeBeats,
  planTempoFromAnchors,
  type BeatAnalysis,
  type BeatAnchor,
} from "./beat-analysis";
export interface BeatDialogHost {
  show(title: string, html: string): void;
  close(): void;
  getSource(): { blob: Blob; name: string; offset: number } | null;
  getRevision(): number;
  apply(plan: {
    tempos: { beat: number; bpm: number }[];
    sourceOffsetSeconds: number;
  }): void;
  seekSource(seconds: number): void;
  error(e: unknown): void;
}
/** Local-only proposal review. Opening or analyzing never mutates the chart. */
export function openBeatDialog(host: BeatDialogHost): void {
  const source = host.getSource();
  if (!source) {
    host.error(
      new Error(
        "先にローカル音声を読み込んでください。YouTubeの音声抽出は行いません。",
      ),
    );
    return;
  }
  const revision = host.getRevision();
  host.show(
    "BPM・拍アンカーの推定と確認",
    `<div id="beat-review"><p>ローカル音声のアタック周期から候補を出します。倍速・半速・裏拍は耳で確認してください。拍子は自動決定しません。</p><p>開始位置は全体のずれだけを補正します。途中でBPMが変わる曲は複数の拍アンカーが必要です。DTXの可変小節長は変更せず、拍数は四分音符単位で入力します。</p><p id="beat-source"></p><button id="beat-run">ローカル音声を解析</button> <button id="beat-stop" disabled>解析中止</button><p id="beat-status" role="status"></p><div id="beat-results"></div><h3>確認済み拍アンカー</h3><p>「音声の秒数 = 譜面の秒数 + 開始オフセット」。最初のアンカーは拍0です。隣り合うアンカー間を一定BPMにし、最後の区間のBPMを以後も使います。</p><p>以下の初期値は仮値です。波形・メトロノームと試聴で各点を確認してください。</p><table><thead><tr><th>譜面の拍</th><th>音声の秒数</th><th>確認</th></tr></thead><tbody id="beat-anchors"></tbody></table><button id="beat-add">アンカーを追加</button><p id="beat-plan" role="status"></p><p><label><input id="beat-confirm" type="checkbox"> アンカーと拍数を試聴・確認しました（既存のテンポマップを置き換えます）</label></p><button id="beat-apply" class="primary">確認したテンポと開始位置を適用</button></div>`,
  );
  const root = document.getElementById("beat-review")!;
  const find = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>("#" + id)!;
  find("beat-source").textContent =
    source.name +
    "（解析は先頭チャンネル使用。ステレオの片側に拍がない場合はモノ音声を用意してください）";
  let controller: AbortController | null = null,
    context: AudioContext | null = null,
    disposed = false;
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      disposed = true;
      controller?.abort();
      void context?.close().catch(() => {});
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const anchors: BeatAnchor[] = [
    { beat: 0, sourceSeconds: Math.max(0, source.offset) },
    { beat: 4, sourceSeconds: Math.max(0, source.offset) + 2 },
  ];
  const resetConfirmation = () => {
    find<HTMLInputElement>("beat-confirm").checked = false;
    try {
      const plan = planTempoFromAnchors(anchors);
      find("beat-plan").textContent =
        `適用予定: 開始 ${plan.sourceOffsetSeconds.toFixed(3)} 秒 / ` +
        plan.tempos
          .map((t) => `拍${t.beat}: ${t.bpm.toFixed(3)} BPM`)
          .join(" → ");
    } catch (e) {
      find("beat-plan").textContent =
        e instanceof Error ? e.message : String(e);
    }
  };
  function renderAnchors() {
    const body = find("beat-anchors");
    body.replaceChildren();
    resetConfirmation();
    anchors.forEach((anchor, index) => {
      const tr = document.createElement("tr");
      for (const key of ["beat", "sourceSeconds"] as const) {
        const td = document.createElement("td"),
          input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "any";
        input.value = String(anchor[key]);
        input.setAttribute(
          "aria-label",
          `${index + 1}番目の${key === "beat" ? "譜面の拍" : "音声秒数"}`,
        );
        if (index === 0 && key === "beat") input.readOnly = true;
        input.addEventListener("input", () => {
          anchor[key] = input.value === "" ? NaN : Number(input.value);
          resetConfirmation();
        });
        td.append(input);
        tr.append(td);
      }
      const td = document.createElement("td"),
        seek = document.createElement("button");
      seek.textContent = "試聴位置へ";
      seek.onclick = () => {
        if (Number.isFinite(anchor.sourceSeconds) && anchor.sourceSeconds >= 0)
          host.seekSource(anchor.sourceSeconds);
      };
      td.append(seek);
      if (index > 0) {
        const remove = document.createElement("button");
        remove.textContent = "削除";
        remove.onclick = () => {
          anchors.splice(index, 1);
          renderAnchors();
        };
        td.append(remove);
      }
      tr.append(td);
      body.append(tr);
    });
  }
  renderAnchors();
  find("beat-add").onclick = () => {
    const last = anchors.at(-1)!;
    anchors.push({
      beat: last.beat + 4,
      sourceSeconds: last.sourceSeconds + 2,
    });
    renderAnchors();
  };
  find("beat-stop").onclick = () => controller?.abort();
  function renderResult(result: BeatAnalysis) {
    const target = find("beat-results");
    target.replaceChildren();
    for (const warning of result.warnings) {
      const p = document.createElement("p");
      p.textContent = warning;
      target.append(p);
    }
    for (const candidate of result.candidates) {
      const button = document.createElement("button");
      button.textContent = `${candidate.bpm.toFixed(2)} BPM / 周期スコア ${candidate.confidence.toFixed(2)}${candidate.basis === "half-time" ? " 半速候補" : candidate.basis === "double-time" ? " 倍速候補" : ""} → 仮アンカー`;
      button.onclick = () => {
        anchors.splice(
          0,
          anchors.length,
          { beat: 0, sourceSeconds: candidate.beatOffsetSeconds },
          {
            beat: 4,
            sourceSeconds: candidate.beatOffsetSeconds + 240 / candidate.bpm,
          },
        );
        renderAnchors();
      };
      target.append(button);
    }
    const details = document.createElement("details"),
      summary = document.createElement("summary");
    summary.textContent = "区間ごとの候補（変化点は手動確認）";
    details.append(summary);
    for (const section of result.sections) {
      const p = document.createElement("p");
      p.textContent = `${section.startSeconds.toFixed(1)}–${section.endSeconds.toFixed(1)} 秒: ${
        section.candidates
          .slice(0, 4)
          .map((c) => c.bpm.toFixed(2) + " BPM")
          .join(" / ") || "候補なし"
      }`;
      details.append(p);
    }
    target.append(details);
  }
  find("beat-run").onclick = async () => {
    if (controller) return;
    controller = new AbortController();
    const signal = controller.signal;
    find<HTMLButtonElement>("beat-run").disabled = true;
    find<HTMLButtonElement>("beat-stop").disabled = false;
    find("beat-status").textContent = "音声をデコード・解析しています…";
    try {
      if (source.blob.size > 100 * 1024 * 1024)
        throw new Error("100 MBを超える音声は短い区間に分割してください。");
      context = new AudioContext();
      const buffer = await context.decodeAudioData(
        await source.blob.arrayBuffer(),
      );
      if (disposed || signal.aborted)
        throw new DOMException("解析を中止しました。", "AbortError");
      const result = await analyzeBeats(
        buffer.getChannelData(0),
        buffer.sampleRate,
        { signal },
      );
      if (disposed) return;
      renderResult(result);
      find("beat-status").textContent =
        `解析済み ${result.durationSeconds.toFixed(1)}秒。候補はまだ適用していません。`;
    } catch (e) {
      if (!disposed)
        find("beat-status").textContent =
          e instanceof Error ? e.message : String(e);
    } finally {
      await context?.close().catch(() => {});
      context = null;
      controller = null;
      if (!disposed) {
        find<HTMLButtonElement>("beat-run").disabled = false;
        find<HTMLButtonElement>("beat-stop").disabled = true;
      }
    }
  };
  find("beat-apply").onclick = () => {
    try {
      if (!find<HTMLInputElement>("beat-confirm").checked)
        throw new Error("各アンカーを試聴し、確認チェックを入れてください。");
      if (host.getRevision() !== revision)
        throw new Error(
          "解析中に譜面が変更されました。この画面を閉じ、現在の譜面から開き直してください。",
        );
      host.apply(planTempoFromAnchors(anchors));
      host.close();
    } catch (e) {
      host.error(e);
    }
  };
}
