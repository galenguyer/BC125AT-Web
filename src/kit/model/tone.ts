/**
 * A channel's CTCSS/DCS squelch setting (SPEC.md §3.2), as the scanner's raw code:
 * `0` none (carrier squelch), `127` search, `240` no tone, `64–113` CTCSS, `128–231` DCS.
 */
export type ToneCode = number

export const TONE_NONE: ToneCode = 0
export const TONE_SEARCH: ToneCode = 127
export const TONE_NO_TONE: ToneCode = 240

/** The 50 CTCSS tones in tenths of a hertz, in code order (code = 64 + index). */
export const ctcssTenthsHz: readonly number[] = [
  670, 693, 719, 744, 770, 797, 825, 854, 885, 915, 948, 974, 1000, 1035, 1072, 1109, 1148, 1188, 1230, 1273,
  1318, 1365, 1413, 1462, 1514, 1567, 1598, 1622, 1655, 1679, 1713, 1738, 1773, 1799, 1835, 1862, 1899, 1928,
  1966, 1995, 2035, 2065, 2107, 2181, 2257, 2291, 2336, 2418, 2503, 2541,
]

/** The 104 DCS codes (octal digits written as a decimal number), in code order (code = 128 + index). */
export const dcsCodes: readonly number[] = [
  23, 25, 26, 31, 32, 36, 43, 47, 51, 53, 54, 65, 71, 72, 73, 74, 114, 115, 116, 122, 125, 131, 132, 134, 143,
  145, 152, 155, 156, 162, 165, 172, 174, 205, 212, 223, 225, 226, 243, 244, 245, 246, 251, 252, 255, 261, 263,
  265, 266, 271, 274, 306, 311, 315, 325, 331, 332, 343, 346, 351, 356, 364, 365, 371, 411, 412, 413, 423, 431,
  432, 445, 446, 452, 454, 455, 462, 464, 465, 466, 503, 506, 516, 523, 526, 532, 546, 565, 606, 612, 624, 627,
  631, 632, 654, 662, 664, 703, 712, 723, 731, 732, 734, 743, 754,
]

export const ctcssTone = (index: number): ToneCode => 64 + index
export const dcsTone = (index: number): ToneCode => 128 + index

export const isCTCSS = (code: ToneCode) => code >= 64 && code <= 113
export const isDCS = (code: ToneCode) => code >= 128 && code <= 231

export const allTones: readonly ToneCode[] = [
  TONE_NONE,
  TONE_SEARCH,
  TONE_NO_TONE,
  ...ctcssTenthsHz.map((_, index) => ctcssTone(index)),
  ...dcsCodes.map((_, index) => dcsTone(index)),
]

/** The tone for a raw code, or `null` if the code isn't one the scanner uses. */
export function toneFromCode(code: number): ToneCode | null {
  if (!Number.isInteger(code)) return null
  return code === TONE_NONE || code === TONE_SEARCH || code === TONE_NO_TONE || isCTCSS(code) || isDCS(code) ? code : null
}

const tenthsText = (tenths: number) => `${Math.trunc(tenths / 10)}.${tenths % 10}`
const dcsText = (code: number) => String(code).padStart(3, '0')

/** `CSQ` (carrier squelch: no tone, opens for any signal), `Search`, `No Tone`, `CTCSS 100.0`, `DCS 023`. */
export function toneName(code: ToneCode): string {
  if (code === TONE_NONE) return 'CSQ'
  if (code === TONE_SEARCH) return 'Search'
  if (code === TONE_NO_TONE) return 'No Tone'
  if (isCTCSS(code)) return `CTCSS ${tenthsText(ctcssTenthsHz[code - 64])}`
  if (isDCS(code)) return `DCS ${dcsText(dcsCodes[code - 128])}`
  return `Code ${code}`
}

const allDigits = (text: string) => /^[0-9]+$/.test(text)

/**
 * Accepts `toneName` forms plus common shorthand: `100.0`, `100`, `D023`, `023N`, `no tone`,
 * `notone`, and bc125py's `ctcss_100.0` / `dcs_23`.
 */
export function parseTone(text: string): ToneCode | null {
  const compact = [...text.toLowerCase()].filter((c) => /[\p{L}\p{N}.]/u.test(c)).join('')
  switch (compact) {
    case '':
    case 'csq':
    case 'none':
    case 'off':
    case 'all':
      return TONE_NONE
    case 'search':
    case 'srch':
      return TONE_SEARCH
    case 'notone':
      return TONE_NO_TONE
  }
  let body = compact
  let dcs = false
  if (body.startsWith('ctcss')) body = body.slice(5)
  else if (body.startsWith('dcs')) {
    body = body.slice(3)
    dcs = true
  } else if (body.startsWith('d')) {
    body = body.slice(1)
    dcs = true
  }
  // `023N` / `023I`: DCS with a normal or inverted suffix.
  const last = body.at(-1)
  if ((last === 'n' || last === 'i') && /^[0-9]*$/.test(body.slice(0, -1))) dcs = true
  if (dcs) {
    if (body.endsWith('n') || body.endsWith('i')) body = body.slice(0, -1)
    if (!allDigits(body)) return null
    const index = dcsCodes.indexOf(Number(body))
    return index < 0 ? null : dcsTone(index)
  }
  const parts = body.split('.')
  if (parts.length > 2 || !allDigits(parts[0])) return null
  const firstDecimal = parts.length === 2 ? parts[1].slice(0, 1) : ''
  const tenths = Number(parts[0]) * 10 + (allDigits(firstDecimal) ? Number(firstDecimal) : 0)
  const index = ctcssTenthsHz.indexOf(tenths)
  return index < 0 ? null : ctcssTone(index)
}

/** How Uniden's software writes a tone: `Off`, `Srch`, `NoTone`, `C110.9`, `D023`. */
export function unidenToneName(code: ToneCode): string {
  if (code === TONE_NONE) return 'Off'
  if (code === TONE_SEARCH) return 'Srch'
  if (code === TONE_NO_TONE) return 'NoTone'
  if (isCTCSS(code)) return `C${tenthsText(ctcssTenthsHz[code - 64])}`
  return `D${dcsText(dcsCodes[code - 128])}`
}

/** Reads exactly the forms `unidenToneName` writes. */
export function toneFromUnidenName(text: string): ToneCode | null {
  switch (text) {
    case 'Off':
      return TONE_NONE
    case 'Srch':
      return TONE_SEARCH
    case 'NoTone':
      return TONE_NO_TONE
  }
  if (text.startsWith('C')) {
    const rest = text.slice(1)
    if (!/^[0-9]+(\.[0-9]+)?$/.test(rest)) return null
    const index = ctcssTenthsHz.indexOf(Math.round(Number(rest) * 10))
    return index < 0 ? null : ctcssTone(index)
  }
  if (text.startsWith('D')) {
    const rest = text.slice(1)
    if (!/^[+-]?[0-9]+$/.test(rest)) return null
    const index = dcsCodes.indexOf(Number(rest))
    return index < 0 ? null : dcsTone(index)
  }
  return null
}
