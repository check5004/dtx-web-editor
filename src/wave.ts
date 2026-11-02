/** Local PCM export used to align a reference track for an actual game BGM. */
export function encodePCM16(
  channels: readonly Float32Array[],
  sampleRate: number,
  startFrame = 0,
): Uint8Array<ArrayBuffer> {
  if (
    !channels.length ||
    channels.length > 2 ||
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000
  )
    throw new Error("対応する音声はモノラル / ステレオです。");
  const length = Math.min(...channels.map((c) => c.length));
  if (!Number.isInteger(startFrame) || startFrame < 0 || startFrame >= length)
    throw new Error("オフセットが音声の長さを超えています。");
  const frames = length - startFrame,
    bytes = frames * channels.length * 2;
  if (bytes > 256 * 1024 * 1024)
    throw new Error(
      "整列後 WAV が 256 MB を超えます。音声を事前に短くしてください。",
    );
  const buffer = new ArrayBuffer(44 + bytes),
    v = new DataView(buffer),
    text = (at: number, s: string) =>
      [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels.length, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels.length * 2, true);
  v.setUint16(32, channels.length * 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, bytes, true);
  for (let frame = 0; frame < frames; frame++)
    for (let c = 0; c < channels.length; c++) {
      const sample = channels[c][frame + startFrame];
      v.setInt16(
        44 + (frame * channels.length + c) * 2,
        Math.round(
          Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0)) *
            32767,
        ),
        true,
      );
    }
  return new Uint8Array(buffer);
}
export async function trimReferenceAudio(
  file: Blob,
  startSeconds: number,
): Promise<Blob> {
  if (!Number.isFinite(startSeconds) || startSeconds < 0)
    throw new Error("トリム位置が不正です。");
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return new Blob(
      [
        encodePCM16(
          Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) =>
            buffer.getChannelData(i),
          ),
          buffer.sampleRate,
          Math.round(startSeconds * buffer.sampleRate),
        ),
      ],
      { type: "audio/wav" },
    );
  } finally {
    await context.close();
  }
}
