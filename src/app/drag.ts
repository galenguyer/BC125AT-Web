import { channelsInBank, isEmptyChannel, type Channel } from '../kit/model/channel'
import { CHANNEL_COUNT, channelAt, type ScannerConfig } from '../kit/model/config'
import { moveChannels, moveChannelsIntoBank } from '../kit/model/moves'
import type { Draft } from 'immer'

/** Dragged channels, as JSON on the drag's data. */
export const DRAG_TYPE = 'application/x-bc125at-channels'

/** Identifies this tab, so a drop can tell a move (same tab) from a copy (another tab). */
export const tabID = crypto.randomUUID()

export interface ChannelDrag {
  source: string
  numbers: number[]
  channels: Channel[]
}

export function readDrag(data: DataTransfer): ChannelDrag | null {
  try {
    const drag = JSON.parse(data.getData(DRAG_TYPE)) as ChannelDrag
    return Array.isArray(drag.numbers) && Array.isArray(drag.channels) ? drag : null
  } catch {
    return null
  }
}

export const isChannelDrag = (data: DataTransfer) => data.types.includes(DRAG_TYPE)

/**
 * A drop of `drag` onto channel `target`: a move if it came from this tab, otherwise a copy into
 * consecutive slots (channel numbers mean nothing in another document). Returns the channel
 * numbers now holding the dragged channels.
 */
export function dropOnChannel(config: Draft<ScannerConfig>, drag: ChannelDrag, target: number): number[] {
  if (drag.source === tabID) return moveChannels(config as ScannerConfig, drag.numbers, target)
  const slots: number[] = []
  for (let n = target; n < Math.min(target + drag.channels.length, CHANNEL_COUNT + 1); n++) slots.push(n)
  slots.forEach((slot, i) => (config.channels[slot - 1] = drag.channels[i]))
  return slots
}

/**
 * A drop onto a bank in the sidebar: moves the channels (or copies them, from another tab) into
 * the bank's first empty slots. Returns `null`, changing nothing, if there isn't room.
 */
export function dropOnBank(config: Draft<ScannerConfig>, drag: ChannelDrag, bank: number): number[] | null {
  if (drag.source === tabID) return moveChannelsIntoBank(config as ScannerConfig, drag.numbers, bank)
  const free = channelsInBank(bank).filter((n) => isEmptyChannel(channelAt(config as ScannerConfig, n)))
  if (free.length < drag.channels.length) return null
  const slots = free.slice(0, drag.channels.length)
  slots.forEach((slot, i) => (config.channels[slot - 1] = drag.channels[i]))
  return slots
}
