import { bankOfChannel, channelsInBank, emptyChannel, isEmptyChannel, makeChannel, type Channel } from './channel'
import { CHANNEL_COUNT, channelAt, type ScannerConfig } from './config'
import type { Frequency } from './frequency'

// These mutate `config` in place; callers pass a draft (immer) or a clone.

const validNumbers = (sources: Iterable<number>) =>
  [...new Set(sources)].sort((a, b) => a - b).filter((n) => n >= 1 && n <= CHANNEL_COUNT)

function apply(config: ScannerConfig, sources: number[], targets: number[]) {
  const moving = sources.map((n) => channelAt(config, n))
  const sourceSet = new Set(sources)
  const targetSet = new Set(targets)
  const displaced = targets.filter((n) => !sourceSet.has(n)).map((n) => channelAt(config, n))
  const freed = sources.filter((n) => !targetSet.has(n))
  targets.forEach((slot, i) => {
    if (i < moving.length) config.channels[slot - 1] = moving[i]
  })
  freed.forEach((slot, i) => {
    if (i < displaced.length) config.channels[slot - 1] = displaced[i]
  })
}

/**
 * Moves the channels in `sources` into consecutive slots starting at `start`, in channel order
 * (SPEC.md §8.2). Channels already in those slots aren't lost: they move, in order, into the slots
 * the moved channels left. Slots past 500 are dropped from the move. Returns the channel numbers
 * the moved channels ended up in.
 */
export function moveChannels(config: ScannerConfig, sources: Iterable<number>, start: number): number[] {
  const moving = validNumbers(sources)
  const targets: number[] = []
  for (let n = start; n < Math.min(start + moving.length, CHANNEL_COUNT + 1); n++) targets.push(n)
  const moved = moving.slice(0, targets.length)
  if (moved.length === 0 || moved.every((n, i) => n === targets[i])) return targets
  apply(config, moved, targets)
  return targets
}

/**
 * Moves channels into the first empty slots of `bank`. Returns the slots used, or `null` (and
 * changes nothing) if the bank doesn't have enough room.
 */
export function moveChannelsIntoBank(config: ScannerConfig, sources: Iterable<number>, bank: number): number[] | null {
  const moving = validNumbers(sources)
  const alreadyThere = moving.filter((n) => bankOfChannel(n) === bank)
  const toMove = moving.filter((n) => bankOfChannel(n) !== bank)
  const free = channelsInBank(bank).filter((n) => isEmptyChannel(channelAt(config, n)))
  if (free.length < toMove.length) return null
  const targets = free.slice(0, toMove.length)
  apply(config, toMove, targets)
  return [...alreadyThere, ...targets].sort((a, b) => a - b)
}

/**
 * Applies `edit` to each channel in `numbers`, then mirrors the scanner's rule that a bank has
 * one priority channel: if an edit turned priority on, the bank's others are cleared.
 */
export function editChannels(config: ScannerConfig, numbers: Iterable<number>, edit: (channel: Channel) => Channel | void) {
  for (const number of numbers) {
    const before = channelAt(config, number)
    const draft = { ...before }
    const result = edit(draft) ?? draft
    config.channels[number - 1] = result
    if (result.priority && !before.priority) {
      for (const other of channelsInBank(bankOfChannel(number))) {
        if (other !== number && channelAt(config, other).priority) {
          config.channels[other - 1] = { ...channelAt(config, other), priority: false }
        }
      }
    }
  }
}

/**
 * Sets a channel's frequency. Giving an empty channel a frequency makes it a new, active channel
 * (empty channels are locked out on the scanner), keeping any name already typed; clearing it
 * empties the channel.
 */
export function setChannelFrequency(config: ScannerConfig, number: number, frequency: Frequency | null) {
  const current = channelAt(config, number)
  if (frequency === null) config.channels[number - 1] = emptyChannel()
  else if (isEmptyChannel(current)) config.channels[number - 1] = makeChannel({ name: current.name, frequency })
  else config.channels[number - 1] = { ...current, frequency }
}
