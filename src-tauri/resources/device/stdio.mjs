// A byte-only stdio carrier. Authentication and all scheduling live in the native host.
import { connect } from "node:net"
const [address, token] = process.argv.slice(2)
if (!address || !token || !/^127\.0\.0\.1:\d+$/.test(address)) throw new Error("Invalid device gateway address")
const socket = connect({ host: "127.0.0.1", port: Number(address.split(":")[1]) })
socket.on("connect", () => {
  socket.write(`${token}\n`)
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
})
socket.on("error", () => {
  process.exitCode = 1
  process.stdin.destroy()
})
socket.on("close", () => {
  process.stdin.destroy()
})
process.stdin.on("end", () => socket.destroy())
process.stdout.on("error", () => socket.destroy())
