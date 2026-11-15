import { invoke } from "@tauri-apps/api/core"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/alwith-ui/select"
import { useRuntimeCapabilities } from "@/lib/runtime-capabilities"
import { SettingRow } from "./shared"

export function RuntimeRow() {
  const capabilities = useRuntimeCapabilities()
  const [choice, setChoice] = useState<"cef" | "wry" | null>(null)
  const [pending, setPending] = useState(false)
  if (!capabilities?.canSwitchBackend) return null
  const backend = choice ?? capabilities.backend
  return <SettingRow title="渲染后端（开发）" aligned>
    <div className="flex items-center gap-2">
      <Select items={[{value:"cef",label:"CEF"},{value:"wry",label:"Wry"}]} value={backend} disabled={pending} onValueChange={(value) => {
        if (value === "cef" || value === "wry") setChoice(value)
      }}>
        <SelectTrigger aria-label="渲染后端"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="cef">CEF</SelectItem>
          <SelectItem value="wry">Wry</SelectItem>
        </SelectGroup></SelectContent>
      </Select>
      <Button variant="outline" disabled={pending || backend === capabilities.backend} onClick={() => {
        setPending(true)
        void invoke("runtime_restart", { backend }).catch((error: unknown) => {
          toast.error(String(error)); setPending(false)
        })
      }}>重启并应用</Button>
    </div>
  </SettingRow>
}
