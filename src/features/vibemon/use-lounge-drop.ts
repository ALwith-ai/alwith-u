import {
  coversHalfOfTarget,
  isStationFullyVisible,
  isWindowCenterInside,
  readVisibleStation,
  stationDefaults,
  StationDragGeneration
} from "@nyssance/atlas/station"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { type RefObject, useEffect, useState } from "react"

import { reportPetError } from "./display-error"
import { requestPet } from "./transport"

export function useLoungeDrop(pane: RefObject<HTMLDivElement | null>) {
  const [highlighted, setHighlighted] = useState(false)
  useEffect(() => {
    const generations = new StationDragGeneration()
    let interval: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      clearInterval(interval)
      interval = undefined
    }
    const geometry = async () => {
      const element = pane.current
      if (!element || !isStationFullyVisible(element)) return null
      const value = await readVisibleStation(
        getCurrentWebviewWindow(),
        element,
        devicePixelRatio,
        stationDefaults,
        getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr"
      )
      return isStationFullyVisible(element) ? value : null
    }
    const bounds = async (pet: WebviewWindow) => {
      const [position, size] = await Promise.all([pet.outerPosition(), pet.outerSize()])
      return { ...position, ...size }
    }
    const start = listen("vibemon:drag-start", () => {
      const generation = generations.begin()
      stop()
      let sampling = false
      const sample = async () => {
        if (sampling) return
        sampling = true
        try {
          const pet = await WebviewWindow.getByLabel("vibemon")
          const station = await geometry()
          const rect = pet && station ? await bounds(pet) : null
          if (generations.isCurrent(generation))
            setHighlighted(station !== null && rect !== null && isWindowCenterInside(rect, station.pane))
        } finally {
          sampling = false
        }
      }
      void sample().catch(reportPetError)
      interval = setInterval(() => {
        void sample().catch(reportPetError)
      }, 50)
    })
    const end = listen("vibemon:drag-end", () => {
      const generation = generations.invalidate()
      stop()
      setHighlighted(false)
      void (async () => {
        const pet = await WebviewWindow.getByLabel("vibemon")
        if (!pet) return
        const rect = await bounds(pet)
        const station = await geometry()
        if (station && generations.isCurrent(generation) && coversHalfOfTarget(rect, station.nest))
          await requestPet("close-pet")
      })().catch(reportPetError)
    })
    return () => {
      generations.invalidate()
      stop()
      void start.then((unlisten) => unlisten()).catch(reportPetError)
      void end.then((unlisten) => unlisten()).catch(reportPetError)
    }
  }, [pane])
  return highlighted
}
