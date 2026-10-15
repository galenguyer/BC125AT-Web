import { describe, expect, it } from 'vitest'
import { csvKind, isValidPickerExtension, nativeKind, pickerTypes, unidenKind } from '../src/app/store/files'

describe('File picker types', () => {
  it("leaves out extensions Chrome's pickers refuse", () => {
    expect(isValidPickerExtension('bc125at')).toBe(true)
    expect(isValidPickerExtension('tar.gz')).toBe(true)
    expect(isValidPickerExtension('bc125at_ss')).toBe(false)
    expect(isValidPickerExtension('')).toBe(false)
  })

  it('gives a Uniden file no filter, so every file is shown', () => {
    expect(pickerTypes(unidenKind, ['txt'])).toEqual([])
  })

  it('keeps filters for the other kinds', () => {
    expect(pickerTypes(nativeKind)).toEqual([{ description: nativeKind.description, accept: { 'application/json': ['.bc125at'] } }])
    expect(pickerTypes(csvKind, ['txt'])[0].accept).toEqual({ 'text/csv': ['.csv', '.txt'] })
  })
})
