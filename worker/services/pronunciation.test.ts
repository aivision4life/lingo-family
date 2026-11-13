import { describe, expect, it } from "vitest";
import { buildPronHeader, createPronClient, PronError } from "./pronunciation";

const decodeHeader = (header: string) => {
  const bytes = Uint8Array.from(atob(header), (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
};

// Padded on purpose: the key must reach Azure trimmed (see azureSpeech.ts).
const env = { AZURE_SPEECH_KEY: " secret-key\r\n", AZURE_SPEECH_REGION: "koreacentral" };

describe("pronunciation assessment client", () => {
  it("carries a Korean reference text through the Base64 header intact", () => {
    expect(decodeHeader(buildPronHeader("사과를 먹어요"))).toEqual({
      ReferenceText: "사과를 먹어요",
      GradingSystem: "HundredMark",
      Granularity: "Phoneme",
      Dimension: "Comprehensive",
      EnableMiscue: "False",
    });
    expect(decodeHeader(buildPronHeader("apple", { miscue: true, alphabet: "IPA", prosody: true }))).toMatchObject({
      EnableMiscue: "True",
      PhonemeAlphabet: "IPA",
      EnableProsodyAssessment: "True",
    });
    // Not asked for, not sent: Azure documents prosody for en-US only.
    expect(decodeHeader(buildPronHeader("사과"))).not.toHaveProperty("EnableProsodyAssessment");
  });

  it("has no client without a key and a valid region", () => {
    expect(createPronClient({})).toBeNull();
    expect(createPronClient({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "evil.com/x" })).toBeNull();
  });

  it("posts the WAV to the region's endpoint in the item's locale", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = createPronClient(env, {
      fetch: async (input, init) => {
        seen.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ RecognitionStatus: "Success" }));
      },
    })!;
    const wav = new ArrayBuffer(8);
    expect(await client.assess(wav, "ko", "사과")).toEqual({ RecognitionStatus: "Success" });

    const { url, init } = seen[0]!;
    expect(url).toBe(
      "https://koreacentral.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ko-KR&format=detailed",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("ocp-apim-subscription-key")).toBe("secret-key");
    expect(headers.get("content-type")).toBe("audio/wav; codecs=audio/pcm; samplerate=16000");
    expect(decodeHeader(headers.get("pronunciation-assessment")!).ReferenceText).toBe("사과");
    expect(init.body).toBe(wav);
  });

  it("turns an HTTP error, a network error and a non-JSON body into PronError, never leaking the key", async () => {
    const failing = (fetch: typeof globalThis.fetch) => createPronClient(env, { fetch })!.assess(new ArrayBuffer(8), "en", "apple");

    const http = await failing(async () => new Response("bad key", { status: 401 })).catch((e: unknown) => e);
    expect(http).toBeInstanceOf(PronError);
    expect((http as PronError).status).toBe(401);
    expect((http as PronError).message).not.toContain("secret-key");

    const network = await failing(async () => Promise.reject(new Error("offline"))).catch((e: unknown) => e);
    expect(network).toBeInstanceOf(PronError);
    expect((network as PronError).status).toBeNull();

    await expect(failing(async () => new Response("<html>"))).rejects.toBeInstanceOf(PronError);
  });
});
