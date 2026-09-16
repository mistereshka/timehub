// Win32 bindings through koffi (prebuilt FFI, no C++ toolchain needed).
import koffi from 'koffi'
import { win32 as path } from 'node:path'

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')
const version = koffi.load('version.dll')

koffi.proto('bool __stdcall EnumChildProc(void *hWnd, intptr_t lParam)')

const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hWnd, void *lpString, int nMaxCount)')
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, void *lpdwProcessId)')
const EnumChildWindows = user32.func('bool __stdcall EnumChildWindows(void *hWndParent, EnumChildProc *lpEnumFunc, intptr_t lParam)')

const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)')
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, void *lpExeName, void *lpdwSize)'
)
const K32EnumProcesses = kernel32.func('bool __stdcall K32EnumProcesses(void *lpidProcess, uint32_t cb, void *lpcbNeeded)')

const GetFileVersionInfoSizeW = version.func('uint32_t __stdcall GetFileVersionInfoSizeW(str16 lptstrFilename, void *lpdwHandle)')
const GetFileVersionInfoW = version.func(
  'bool __stdcall GetFileVersionInfoW(str16 lptstrFilename, uint32_t dwHandle, uint32_t dwLen, void *lpData)'
)
const VerQueryValueW = version.func(
  'bool __stdcall VerQueryValueW(void *pBlock, str16 lpSubBlock, _Out_ void **lplpBuffer, _Out_ uint32_t *puLen)'
)

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

export interface ForegroundWindow {
  pid: number
  exePath: string
  exeName: string
  title: string
}

const titleBuf = Buffer.alloc(1024)
const pidBuf = Buffer.alloc(4)
const pathBuf = Buffer.alloc(2048)
const sizeBuf = Buffer.alloc(4)

function windowTitle(hwnd: unknown): string {
  const n = GetWindowTextW(hwnd, titleBuf, titleBuf.length / 2)
  return n > 0 ? titleBuf.toString('utf16le', 0, n * 2) : ''
}

function windowPid(hwnd: unknown): number {
  pidBuf.writeUInt32LE(0)
  GetWindowThreadProcessId(hwnd, pidBuf)
  return pidBuf.readUInt32LE(0)
}

export function processPath(pid: number): string | null {
  if (!pid) return null
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (!handle) return null
  try {
    sizeBuf.writeUInt32LE(pathBuf.length / 2)
    if (!QueryFullProcessImageNameW(handle, 0, pathBuf, sizeBuf)) return null
    return pathBuf.toString('utf16le', 0, sizeBuf.readUInt32LE(0) * 2)
  } finally {
    CloseHandle(handle)
  }
}

export function getForegroundWindow(): ForegroundWindow | null {
  const hwnd = GetForegroundWindow()
  if (!hwnd) return null
  const title = windowTitle(hwnd)
  let pid = windowPid(hwnd)
  let exePath = processPath(pid)
  if (exePath && path.basename(exePath).toLowerCase() === 'applicationframehost.exe') {
    // UWP apps are hosted by ApplicationFrameHost; the real process owns a child window.
    const hostPid = pid
    EnumChildWindows(
      hwnd,
      (child: unknown) => {
        const childPid = windowPid(child)
        if (childPid && childPid !== hostPid) {
          pid = childPid
          return false
        }
        return true
      },
      0
    )
    if (pid !== hostPid) exePath = processPath(pid) ?? exePath
  }
  // Protected/elevated processes can't be queried; group them as "unknown".
  if (!exePath) return { pid, exePath: '', exeName: 'unknown', title }
  return { pid, exePath, exeName: path.basename(exePath), title }
}

const pidsBuf = Buffer.alloc(4 * 8192)
const neededBuf = Buffer.alloc(4)

/** Running processes we are allowed to query, with their executable paths. */
export function listProcesses(): { pid: number; path: string }[] {
  if (!K32EnumProcesses(pidsBuf, pidsBuf.length, neededBuf)) return []
  const count = neededBuf.readUInt32LE(0) / 4
  const out: { pid: number; path: string }[] = []
  for (let i = 0; i < count; i++) {
    const pid = pidsBuf.readUInt32LE(i * 4)
    const path = processPath(pid)
    if (path) out.push({ pid, path })
  }
  return out
}

/** Full executable paths of all running processes we are allowed to query. */
export function listProcessPaths(): string[] {
  return [...new Set(listProcesses().map((p) => p.path))]
}

const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumChildProc *lpEnumFunc, intptr_t lParam)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hWnd)')
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *hWnd)')

/**
 * Processes that own a visible, titled top-level window, with that window's title. Used to tell a
 * game that is actually open from one idling in the tray (e.g. Roblox), and Minecraft from other Java.
 */
export function visibleWindowTitles(): Map<number, string> {
  const titles = new Map<number, string>()
  EnumWindows(
    (hwnd: unknown) => {
      if (IsWindowVisible(hwnd) && GetWindowTextLengthW(hwnd) > 0) {
        const pid = windowPid(hwnd)
        const title = windowTitle(hwnd)
        // a game's own window wins over its splash or console windows
        if (!titles.has(pid) || /^minecraft\b/i.test(title)) titles.set(pid, title)
      }
      return true
    },
    0
  )
  return titles
}

export function visibleWindowPids(): Set<number> {
  return new Set(visibleWindowTitles().keys())
}

const GetProcessTimes = kernel32.func(
  'bool __stdcall GetProcessTimes(void *hProcess, void *lpCreationTime, void *lpExitTime, void *lpKernelTime, void *lpUserTime)'
)
const fileTimes = [Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)]
/** 1601-01-01 → 1970-01-01 in milliseconds (FILETIME counts 100 ns steps from 1601). */
const FILETIME_EPOCH_MS = 11_644_473_600_000n

/** When a process started (ms since the epoch), or null if it can't be queried. */
export function processStartTime(pid: number): number | null {
  if (!pid) return null
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (!handle) return null
  try {
    if (!GetProcessTimes(handle, fileTimes[0], fileTimes[1], fileTimes[2], fileTimes[3])) return null
    return Number(fileTimes[0].readBigUInt64LE(0) / 10_000n - FILETIME_EPOCH_MS)
  } finally {
    CloseHandle(handle)
  }
}

const descriptions = new Map<string, string | null>()
const hex4 = (n: number): string => n.toString(16).padStart(4, '0')

/** FileDescription from the executable's version resource, e.g. "Visual Studio Code". */
export function fileDescription(exePath: string): string | null {
  if (!exePath) return null
  const cached = descriptions.get(exePath)
  if (cached !== undefined) return cached
  let result: string | null = null
  try {
    const size = GetFileVersionInfoSizeW(exePath, null)
    if (size > 0) {
      const data = Buffer.alloc(size)
      if (GetFileVersionInfoW(exePath, 0, size, data)) {
        const ptr: unknown[] = [null]
        const len: number[] = [0]
        const candidates: string[] = []
        if (VerQueryValueW(data, '\\VarFileInfo\\Translation', ptr, len) && len[0] >= 4) {
          const [lang, codepage] = Array.from(koffi.decode(ptr[0], 'uint16_t', 2) as ArrayLike<number>)
          candidates.push(hex4(lang) + hex4(codepage))
        }
        candidates.push('040904b0', '040904e4', '041904b0', '000004b0')
        for (const c of candidates) {
          if (VerQueryValueW(data, `\\StringFileInfo\\${c}\\FileDescription`, ptr, len) && len[0] > 1) {
            const text = koffi.decode.string16(ptr[0]).trim()
            if (text) {
              result = text
              break
            }
          }
        }
      }
    }
  } catch {
    result = null
  }
  descriptions.set(exePath, result)
  return result
}
