import { pinyin } from "pinyin-pro"

const HAN = /\p{Script=Han}/u
const HAN_RUNS = /\p{Script=Han}+/gu
/** Combining marks of Latin, Greek and Cyrillic letters; kana voicing marks are not among them. */
const LATIN_MARKS = new RegExp(String.raw`[\u0300-\u036f]`, "g")

/** The one fold every name and every query goes through: width, case and Latin accents. */
export function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase().normalize("NFD").replace(LATIN_MARKS, "").normalize("NFC")
}

/**
 * The Latin reading of a name: Han runs become their pinyin syllables, one space apart, so both
 * `wx` and `weixin` reach `微信` through word starts. Text without Han comes back unchanged.
 */
export function latin(text: string): string {
  if (!HAN.test(text)) return text
  return text
    .replace(HAN_RUNS, (run) => ` ${pinyin(run, { toneType: "none", type: "array", v: true }).join(" ")} `)
    .replaceAll(/ {2,}/g, " ")
    .trim()
}
