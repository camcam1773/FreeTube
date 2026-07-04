import { spawn } from 'child_process'
import { dialog, BrowserWindow, app } from 'electron'
import { isFreeTubeUrl } from './utils'

// Store active processes to allow cancellation or cleanup on app exit
const activeDownloads = new Map()

/**
 * Handle IPC invoke choose-directory
 */
export async function handleChooseDirectory(event, currentPath) {
  if (!isFreeTubeUrl(event.senderFrame.url)) {
    return null
  }

  const dialogOptions = {
    defaultPath: currentPath || app.getPath('downloads'),
    properties: ['openDirectory']
  }

  const window = BrowserWindow.fromWebContents(event.sender)
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
}

/**
 * Handle IPC invoke choose-file
 */
export async function handleChooseFile(event, currentPath) {
  if (!isFreeTubeUrl(event.senderFrame.url)) {
    return null
  }

  const dialogOptions = {
    defaultPath: currentPath || undefined,
    properties: ['openFile']
  }

  const window = BrowserWindow.fromWebContents(event.sender)
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
}

/**
 * Handle IPC send start-download
 */
export function handleStartDownload(event, payload) {
  if (!isFreeTubeUrl(event.senderFrame.url)) {
    return
  }

  const { videoUrl, quality, audioOnly, downloadDir, ytdlpPath, sponsorBlockRemove, sponsorBlockApi } = payload

  // Check if already downloading this URL
  if (activeDownloads.has(videoUrl)) {
    event.sender.send('download-error', 'This download is already in progress.')
    return
  }

  const exePath = ytdlpPath && ytdlpPath.trim() !== '' ? ytdlpPath.trim() : 'yt-dlp'

  const args = [
    '--ignore-config',
    '--newline',
    '--progress',
    videoUrl
  ]

  // Setup format arguments based on options
  if (audioOnly) {
    args.push('-f', 'bestaudio/best')
    if (quality === 'mp3') {
      args.push('-x', '--audio-format', 'mp3')
    }
  } else {
    // Video quality selection
    let formatStr = 'bestvideo+bestaudio/best' // best quality default
    if (quality === '2160p') {
      formatStr = 'bestvideo[height<=2160]+bestaudio/best'
    } else if (quality === '1440p') {
      formatStr = 'bestvideo[height<=1440]+bestaudio/best'
    } else if (quality === '1080p') {
      formatStr = 'bestvideo[height<=1080]+bestaudio/best'
    } else if (quality === '720p') {
      formatStr = 'bestvideo[height<=720]+bestaudio/best'
    } else if (quality === '480p') {
      formatStr = 'bestvideo[height<=480]+bestaudio/best'
    } else if (quality === '360p') {
      formatStr = 'bestvideo[height<=360]+bestaudio/best'
    }
    args.push('-f', formatStr, '--merge-output-format', 'mp4')
  }

  // Setup download path
  const targetDir = downloadDir && downloadDir.trim() !== '' ? downloadDir.trim() : app.getPath('downloads')
  args.push('-o', `${targetDir}/%(title)s.%(ext)s`)

  // Add SponsorBlock options if enabled
  if (sponsorBlockRemove) {
    args.push('--sponsorblock-remove', sponsorBlockRemove)
  }
  if (sponsorBlockApi) {
    args.push('--sponsorblock-api', sponsorBlockApi)
  }

  let downloadProcess
  try {
    downloadProcess = spawn(exePath, args)
  } catch (err) {
    event.sender.send('download-error', { videoUrl, error: `Failed to start yt-dlp: ${err.message}` })
    return
  }

  activeDownloads.set(videoUrl, downloadProcess)

  let lastStderr = ''

  downloadProcess.stdout.on('data', (data) => {
    const output = data.toString()
    const lines = output.split(/[\r\n]+/)

    for (const line of lines) {
      if (line.includes('[download]')) {
        const progressMatch = line.match(/(\d+(?:\.\d+)?)%/)
        if (progressMatch) {
          const percent = progressMatch[1]
          let speed = ''
          let eta = ''

          const speedMatch = line.match(/at\s+([^\s]+)/)
          if (speedMatch) speed = speedMatch[1]

          const etaMatch = line.match(/ETA\s+([^\s]+)/)
          if (etaMatch) eta = etaMatch[1]

          event.sender.send('download-progress', { videoUrl, percent, speed, eta })
        }
      }
    }
  })

  downloadProcess.stderr.on('data', (data) => {
    lastStderr += data.toString()
  })

  downloadProcess.on('error', (err) => {
    activeDownloads.delete(videoUrl)
    event.sender.send('download-error', { videoUrl, error: `Process error: ${err.message}` })
  })

  downloadProcess.on('close', (code) => {
    activeDownloads.delete(videoUrl)
    if (code === 0) {
      event.sender.send('download-finished', { videoUrl })
    } else {
      const errorMsg = lastStderr.trim() || `Process exited with code ${code}`
      event.sender.send('download-error', { videoUrl, error: errorMsg })
    }
  })
}

/**
 * Handle IPC send cancel-download
 */
export function handleCancelDownload(event, videoUrl) {
  if (!isFreeTubeUrl(event.senderFrame.url)) {
    return
  }

  const proc = activeDownloads.get(videoUrl)
  if (proc) {
    try {
      proc.kill()
    } catch { }
    activeDownloads.delete(videoUrl)
  }
}

/**
 * Handle IPC invoke get-download-metadata
 */
export async function handleGetDownloadMetadata(event, payload) {
  if (!isFreeTubeUrl(event.senderFrame.url)) {
    return null
  }

  const { videoUrl, ytdlpPath } = payload
  const exePath = ytdlpPath && ytdlpPath.trim() !== '' ? ytdlpPath.trim() : 'yt-dlp'

  const args = [
    '--ignore-config',
    '--simulate',
    '--dump-json',
    videoUrl
  ]

  return new Promise((resolve) => {
    let stdoutData = ''
    let stderrData = ''
    let child

    try {
      child = spawn(exePath, args)
    } catch (err) {
      resolve({ success: false, error: `Failed to spawn yt-dlp: ${err.message}` })
      return
    }

    child.stdout.on('data', (data) => {
      stdoutData += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderrData += data.toString()
    })

    child.on('error', (err) => {
      resolve({ success: false, error: `Failed to run yt-dlp: ${err.message}` })
    })

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const metadata = JSON.parse(stdoutData)
          resolve({ success: true, metadata })
        } catch (err) {
          resolve({ success: false, error: `Failed to parse metadata: ${err.message}` })
        }
      } else {
        resolve({ success: false, error: stderrData.trim() || `Process exited with code ${code}` })
      }
    })
  })
}

// Cleanup active downloads when the app exits
app.on('will-quit', () => {
  for (const [url, proc] of activeDownloads.entries()) {
    try {
      proc.kill()
    } catch { }
  }
  activeDownloads.clear()
})
