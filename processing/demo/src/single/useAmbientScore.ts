import { useEffect, useRef, useState } from 'react'

// A quiet, original synthesized drone. Starts only after a user gesture.
export function useAmbientScore() {
  const [enabled, setEnabled] = useState(false)
  const audio = useRef<{ context: AudioContext; nodes: AudioNode[] } | null>(null)
  useEffect(() => {
    if (!enabled) return
    const context = new AudioContext()
    const master = context.createGain()
    master.gain.setValueAtTime(0, context.currentTime)
    master.gain.linearRampToValueAtTime(.055, context.currentTime + 2)
    master.connect(context.destination)
    const nodes: AudioNode[] = [master]
    for (const [frequency, volume, type] of [[110, .36, 'sine'], [165, .15, 'sine'], [220, .09, 'triangle'], [329.63, .035, 'sine']] as const) {
      const oscillator = context.createOscillator(), gain = context.createGain()
      oscillator.type = type
      oscillator.frequency.value = frequency
      gain.gain.value = volume
      oscillator.connect(gain).connect(master)
      oscillator.start()
      nodes.push(oscillator, gain)
    }
    const sway = context.createOscillator(), depth = context.createGain()
    sway.frequency.value = .085
    depth.gain.value = .012
    sway.connect(depth).connect(master.gain)
    sway.start()
    nodes.push(sway, depth)
    audio.current = { context, nodes }
    void context.resume()
    return () => {
      master.gain.setTargetAtTime(0, context.currentTime, .3)
      window.setTimeout(() => { void context.close() }, 1200)
      audio.current = null
    }
  }, [enabled])
  return { enabled, toggle: () => setEnabled(value => !value) }
}
