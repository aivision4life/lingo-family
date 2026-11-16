// Real `ko-KR` bodies from Azure Pronunciation Assessment, captured by `npm run pron-probe` on
// 2026-11-16 (full bodies in `data/pron-probe/out/`, which is gitignored). Trimmed to the fields
// `normalizePron` reads, otherwise exactly what Azure answered: the rules below are only worth
// anything if they are tested against what the service really says, not what the docs promise.
//
// Used by the unit tests and by `fakePron`, so a route test sees a realistic answer too.

/** 사과 spoken correctly by TTS: PronScore 99.4, both letters 99. */
export const AZURE_KO_WORD = {
  "RecognitionStatus": "Success",
  "SNR": 45.684372,
  "NBest": [
    {
      "Lexical": "사과",
      "AccuracyScore": 99,
      "FluencyScore": 100,
      "CompletenessScore": 100,
      "PronScore": 99.4,
      "Words": [
        {
          "Word": "사과",
          "AccuracyScore": 99,
          "ErrorType": "None",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 99
            },
            {
              "Syllable": "",
              "AccuracyScore": 99
            }
          ]
        }
      ]
    }
  ]
} as const;

/** 포도 scored against the reference text 사과: Mispronunciation, letters 32 and 13. */
export const AZURE_KO_WRONG = {
  "RecognitionStatus": "Success",
  "SNR": 38.5326,
  "NBest": [
    {
      "Lexical": "사과",
      "AccuracyScore": 30,
      "FluencyScore": 0,
      "CompletenessScore": 0,
      "PronScore": 6,
      "Words": [
        {
          "Word": "사과",
          "AccuracyScore": 30,
          "ErrorType": "Mispronunciation",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 32
            },
            {
              "Syllable": "",
              "AccuracyScore": 13
            }
          ]
        }
      ]
    }
  ]
} as const;

/** Five words; `Words` lines up with the reference text split on whitespace. */
export const AZURE_KO_SENTENCE = {
  "RecognitionStatus": "Success",
  "SNR": 45.572403,
  "NBest": [
    {
      "Lexical": "저는 매일 아침에 사과를 먹어요",
      "AccuracyScore": 100,
      "FluencyScore": 99,
      "CompletenessScore": 100,
      "PronScore": 99.4,
      "Words": [
        {
          "Word": "저는",
          "AccuracyScore": 100,
          "ErrorType": "None",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            }
          ]
        },
        {
          "Word": "매일",
          "AccuracyScore": 100,
          "ErrorType": "None",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            }
          ]
        },
        {
          "Word": "아침에",
          "AccuracyScore": 100,
          "ErrorType": "None",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            }
          ]
        },
        {
          "Word": "사과를",
          "AccuracyScore": 98,
          "ErrorType": "None",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 98
            },
            {
              "Syllable": "",
              "AccuracyScore": 98
            },
            {
              "Syllable": "",
              "AccuracyScore": 98
            }
          ]
        },
        {
          "Word": "먹어요",
          "AccuracyScore": 100,
          "ErrorType": "None",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            }
          ]
        }
      ]
    }
  ]
} as const;

/** 같이 먹었어요: one word's letters do not all score the same (100, 100, 100, 80). */
export const AZURE_KO_UNEVEN = {
  "RecognitionStatus": "Success",
  "SNR": 47.40625,
  "NBest": [
    {
      "Lexical": "같이 먹었어요",
      "AccuracyScore": 99,
      "FluencyScore": 100,
      "CompletenessScore": 100,
      "PronScore": 99.4,
      "Words": [
        {
          "Word": "같이",
          "AccuracyScore": 100,
          "ErrorType": "None",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            }
          ]
        },
        {
          "Word": "먹었어요",
          "AccuracyScore": 98,
          "ErrorType": "None",
          "Syllables": [
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 100
            },
            {
              "Syllable": "",
              "AccuracyScore": 80
            }
          ]
        }
      ]
    }
  ]
} as const;
