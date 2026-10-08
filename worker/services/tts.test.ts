import { describe, expect, it } from "vitest";
import { AUDIO_KEY_PATTERN, audioKey, buildSsml, createTtsClient, escapeXml, voiceFor } from "./tts";

describe("TTS helpers", () => {
  it("builds content-addressed keys from lang + voice + normalized text", async () => {
    const key = await audioKey("ko", "ko-KR-SunHiNeural", "학생");
    expect(key).toMatch(/^audio\/ko\/ko-KR-SunHiNeural\/[0-9a-f]{40}\.mp3$/);
    expect(AUDIO_KEY_PATTERN.test(key)).toBe(true);
    // Same text after NFC + trim → same file; another voice → another file.
    expect(await audioKey("ko", "ko-KR-SunHiNeural", ` ${"학생".normalize("NFD")} `)).toBe(key);
    expect(await audioKey("ko", "ko-KR-InJoonNeural", "학생")).not.toBe(key);
  });

  it("escapes text inside SSML", () => {
    expect(escapeXml(`a<b & "c"`)).toBe("a&lt;b &amp; &quot;c&quot;");
    const ssml = buildSsml("Tom & Jerry <3", "en", "en-US-JennyNeural");
    expect(ssml).toContain('xml:lang="en-US"');
    expect(ssml).toContain('<voice name="en-US-JennyNeural">Tom &amp; Jerry &lt;3</voice>');
  });

  it("uses default voices unless vars override them", () => {
    expect(voiceFor({}, "zh")).toBe("zh-CN-XiaoxiaoNeural");
    expect(voiceFor({ TTS_VOICE_KO: "ko-KR-InJoonNeural" }, "ko")).toBe("ko-KR-InJoonNeural");
    expect(voiceFor({ TTS_VOICE_EN: " " }, "en")).toBe("en-US-JennyNeural");
  });

  it("has no Azure client without key and a valid region", () => {
    expect(createTtsClient({})).toBeNull();
    expect(createTtsClient({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "evil.com/x" })).toBeNull();
    expect(createTtsClient({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "koreacentral" })).not.toBeNull();
  });
});
