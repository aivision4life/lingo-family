import { describe, expect, it } from "vitest";
import { azureSpeechConfig } from "./azureSpeech";

describe("azureSpeechConfig", () => {
  it("trims the key as well as the region: a padded secret is not a wrong secret", () => {
    expect(azureSpeechConfig({ AZURE_SPEECH_KEY: "  abc123\r\n", AZURE_SPEECH_REGION: " koreacentral\n" })).toEqual({
      key: "abc123",
      region: "koreacentral",
    });
  });

  it("is not configured without a key, with a blank key, or with a region that is not a region id", () => {
    expect(azureSpeechConfig({})).toBeNull();
    expect(azureSpeechConfig({ AZURE_SPEECH_KEY: " \n", AZURE_SPEECH_REGION: "koreacentral" })).toBeNull();
    expect(azureSpeechConfig({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "evil.com/x" })).toBeNull();
    expect(azureSpeechConfig({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "" })).toBeNull();
  });
});
