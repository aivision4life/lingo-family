import { describe, expect, it } from "vitest";
import {
  checkEnglishText,
  checkEnrichment,
  checkGlosses,
  checkKoreanText,
  checkLangText,
  checkPhrase,
  checkPhraseFill,
  checkSentence,
  checkSentenceCheck,
  checkTopikVocabEntry,
  checkVietnameseText,
} from "./contentCheck";

describe("checkKoreanText", () => {
  it("flags the reported bug: a lone Latin letter inside a Korean sentence", () => {
    expect(checkKoreanText("이야기에 a 빠져들다 보니 어느새 밤이 깊었다.")).toEqual(['a lone Latin letter "a"']);
  });

  it("accepts a pure Korean sentence (incl. transliterated loanwords like 커피)", () => {
    expect(checkKoreanText("저는 아침에 커피를 마셔요.")).toEqual([]);
  });

  it("accepts digits and punctuation", () => {
    expect(checkKoreanText("오늘은 2026년 10월 15일, 날씨가 맑다!")).toEqual([]);
  });

  it("accepts common Latin acronym loanwords (TV, AI, ...)", () => {
    expect(checkKoreanText("저는 TV로 AI 뉴스를 봤어요.")).toEqual([]);
  });

  it("flags an ordinary Latin word that is not a known loanword", () => {
    expect(checkKoreanText("저는 hello 라고 말했다.")).toEqual(['a Latin word "hello"']);
  });

  it("allows an explicitly allowed word (e.g. the term being studied, in Latin script)", () => {
    expect(checkKoreanText("저는 매일 Netflix를 봐요.", ["Netflix"])).toEqual([]);
    expect(checkKoreanText("저는 매일 netflix를 봐요.", ["Netflix"])).toEqual([]); // case-insensitive
  });

  it("flags stray Han/Kana characters outside the Hanja field", () => {
    expect(checkKoreanText("これは学生です")).toContain("Chinese/Japanese characters outside the Hanja field");
  });
});

describe("checkEnglishText", () => {
  it("accepts an ordinary English sentence", () => {
    expect(checkEnglishText("I drink coffee every morning.")).toEqual([]);
  });

  it("flags Hangul", () => {
    expect(checkEnglishText("I am a 학생.")).toEqual(["Hangul in English text"]);
  });

  it("flags Han/Kana", () => {
    expect(checkEnglishText("I am a 学生.")).toEqual(["Chinese/Japanese characters in English text"]);
  });
});

describe("checkVietnameseText", () => {
  it("accepts Vietnamese text with diacritics", () => {
    expect(checkVietnameseText("Tôi uống cà phê mỗi sáng.")).toEqual([]);
  });

  it("flags Hangul", () => {
    expect(checkVietnameseText("Tôi là 학생.")).toEqual(["Hangul in Vietnamese text"]);
  });
});

describe("checkLangText", () => {
  it("picks the Korean check for lang=ko and the English check for lang=en", () => {
    expect(checkLangText("ko", "저는 학생이에요.")).toEqual([]);
    expect(checkLangText("en", "I am a student.")).toEqual([]);
    expect(checkLangText("en", "I am 학생.")).toEqual(["Hangul in English text"]);
  });
});

const sentence = (over: Partial<Parameters<typeof checkSentence>[1]> = {}) => ({
  sentence: "저는 학생이에요.",
  translation_vi: "Tôi là học sinh.",
  translation_en: "I am a student.",
  translation_ko: "",
  image_prompt: "x",
  ...over,
});

describe("checkSentence", () => {
  it("accepts a clean Korean sentence with its translations", () => {
    expect(checkSentence("ko", sentence())).toEqual([]);
  });

  it("flags the bug sentence, prefixed with the field name", () => {
    expect(checkSentence("ko", sentence({ sentence: "이야기에 a 빠져들다 보니 어느새 밤이 깊었다." }))).toEqual(['sentence: a lone Latin letter "a"']);
  });

  it("flags a translation in the wrong script", () => {
    expect(checkSentence("ko", sentence({ translation_vi: "Tôi là 학생." }))).toEqual(["translation_vi: Hangul in Vietnamese text"]);
  });

  it("never checks the sentence's own-language translation, even when it is a non-empty placeholder", () => {
    // The LLM is told to leave this "" and the server discards it either way; checking it caused
    // a false positive on a one-character placeholder (read as a stray Latin letter).
    expect(checkSentence("ko", sentence({ translation_ko: "x" }))).toEqual([]);
    expect(checkSentence("en", sentence({ sentence: "I am a student.", translation_en: "x" }))).toEqual([]);
  });
});

describe("checkGlosses", () => {
  it("accepts a clean vi/en/ko gloss triple", () => {
    expect(checkGlosses({ gloss_vi: "học sinh", gloss_en: "student", gloss_ko: "배우는 사람" })).toEqual([]);
  });

  it("flags a gloss field in the wrong script", () => {
    expect(checkGlosses({ gloss_vi: "học sinh", gloss_en: "student", gloss_ko: "student" })).toEqual(['gloss_ko: a Latin word "student"']);
  });
});

describe("checkPhrase", () => {
  const phrase = {
    text: "대학생",
    reading: "daehaksaeng",
    gloss_vi: "sinh viên",
    gloss_en: "university student",
    gloss_ko: "대학에 다니는 학생",
    image_prompt: "x",
    example: sentence({ sentence: "저는 대학생이에요." }),
  };

  it("accepts a clean phrase", () => {
    expect(checkPhrase("ko", phrase)).toEqual([]);
  });

  it("flags a bad phrase text and prefixes its own example separately", () => {
    expect(checkPhrase("ko", { ...phrase, text: "대학생 a", example: sentence({ sentence: "이야기에 a 빠져들다." }) })).toEqual([
      'text: a lone Latin letter "a"',
      'example: sentence: a lone Latin letter "a"',
    ]);
  });
});

describe("checkEnrichment", () => {
  const good = {
    gloss_vi: "học sinh",
    gloss_en: "student",
    gloss_ko: "배우는 사람",
    examples: [sentence(), sentence({ sentence: "학생이 많아요." })],
    phrases: [
      {
        text: "대학생",
        reading: "daehaksaeng",
        gloss_vi: "sinh viên",
        gloss_en: "university student",
        gloss_ko: "대학에 다니는 학생",
        image_prompt: "x",
        example: sentence({ sentence: "저는 대학생이에요." }),
      },
    ],
  };

  it("accepts a fully clean enrichment", () => {
    expect(checkEnrichment("ko", good)).toEqual([]);
  });

  it("finds the bad example by index and leaves the other one alone", () => {
    const withBugExample = {
      ...good,
      examples: [good.examples[0]!, sentence({ sentence: "이야기에 a 빠져들다 보니 어느새 밤이 깊었다." })],
    };
    expect(checkEnrichment("ko", withBugExample)).toEqual(['examples[1]: sentence: a lone Latin letter "a"']);
  });
});

describe("checkSentenceCheck", () => {
  const base = {
    translation_vi: "Tôi là học sinh.",
    translation_en: "I am a student.",
    translation_ko: "",
    image_prompt: "x",
    contains_word: true,
    suggestion: "",
    suggestion_translation_vi: "",
    suggestion_translation_en: "",
    suggestion_translation_ko: "",
    suggestion_image_prompt: "",
    note_vi: "",
  };

  it("accepts a clean check with no suggestion", () => {
    expect(checkSentenceCheck("ko", base)).toEqual([]);
  });

  it("checks the suggestion text when there is one", () => {
    expect(checkSentenceCheck("ko", { ...base, suggestion: "이야기에 a 빠져들다." })).toEqual(['suggestion: sentence: a lone Latin letter "a"']);
  });

  it("checks note_vi", () => {
    expect(checkSentenceCheck("ko", { ...base, note_vi: "학생 문장이 더 자연스러워요." })).toEqual(["note_vi: Hangul in Vietnamese text"]);
  });
});

describe("checkPhraseFill", () => {
  it("accepts a clean gloss triple and flags a bad one", () => {
    expect(checkPhraseFill({ gloss_vi: "sinh viên", gloss_en: "university student", gloss_ko: "대학생" })).toEqual([]);
    expect(checkPhraseFill({ gloss_vi: "sinh viên", gloss_en: "university student", gloss_ko: "university student" })).toEqual([
      'gloss_ko: a Latin word "university"',
      'gloss_ko: a Latin word "student"',
    ]);
  });
});

describe("checkTopikVocabEntry", () => {
  it("accepts a clean entry", () => {
    expect(checkTopikVocabEntry({ surface: "일어나서", lemma: "일어나다", gloss_vi: "thức dậy" })).toEqual([]);
  });

  it("flags Hangul leaking into the Vietnamese gloss", () => {
    expect(checkTopikVocabEntry({ surface: "전화", lemma: "전화", gloss_vi: "학생" })).toEqual(["gloss_vi: Hangul in Vietnamese text"]);
  });

  it("flags a stray Latin letter in the surface/lemma form", () => {
    expect(checkTopikVocabEntry({ surface: "일어나a서", lemma: "일어나다", gloss_vi: "thức dậy" })).toEqual(['surface: a lone Latin letter "a"']);
  });
});
