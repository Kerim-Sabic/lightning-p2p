const BIDI_FORMATTING_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
// These ranges intentionally match invisible C0/C1 controls in untrusted labels.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;
const REPEATED_WHITESPACE = /\s+/gu;

/** Makes untrusted single-line names safe to compare visually without changing stored values. */
export function safeDisplayText(value: string, fallback: string): string {
  const display = value
    .replace(BIDI_FORMATTING_CONTROLS, "�")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(REPEATED_WHITESPACE, " ")
    .trim();

  return display.replace(/[\uFFFD\s]/gu, "") ? display : fallback;
}
