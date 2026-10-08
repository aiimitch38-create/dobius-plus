// Aggregate measurements only. Frames are never logged or written to disk.
const { app, desktopCapturer, screen, systemPreferences } = require('electron')
const { performance, monitorEventLoopDelay } = require('node:perf_hooks')

app.whenReady().then(async () => {
  app.dock?.hide()
  const permission = systemPreferences.getMediaAccessStatus('screen')
  if (permission !== 'granted') {
    console.log(JSON.stringify({ backend: 'a', status: 'blocked', permission }))
    app.exit(2)
    return
  }
  const display = screen.getPrimaryDisplay()
  const width = Math.min(1280, display.size.width)
  const height = Math.round(width * display.size.height / display.size.width)
  const lag = monitorEventLoopDelay({ resolution: 10 })
  lag.enable()
  const initialCpu = process.cpuUsage()
  const started = performance.now()
  let frames = 0
  let bytes = 0
  let firstFrameMs = null
  let peakRss = process.memoryUsage().rss
  let cpuPercent = 0
  while (performance.now() - started < 60000) {
    const tick = performance.now()
    const sources = await desktopCapturer.getSources({
      types: ['screen'], thumbnailSize: { width, height }, fetchWindowIcons: false
    })
    const source = sources.find((item) => item.display_id === String(display.id))
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('capture_unavailable')
    }
    const jpeg = source.thumbnail.toJPEG(60)
    bytes += jpeg.length
    frames++
    if (firstFrameMs === null) {
      firstFrameMs = performance.now() - started
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    cpuPercent = app.getAppMetrics().reduce((total, metric) => total + metric.cpu.percentCPUUsage, 0)
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1000 / 3 - (performance.now() - tick))))
  }
  const elapsedSeconds = (performance.now() - started) / 1000
  const cpu = process.cpuUsage(initialCpu)
  lag.disable()
  console.log(JSON.stringify({
    backend: 'a', status: 'measured', width, height, quality: 60,
    elapsedSeconds, frames, producedFps: frames / elapsedSeconds, firstFrameMs,
    eventLoopLagMs: { p50: lag.percentile(50) / 1e6, p95: lag.percentile(95) / 1e6, max: lag.max / 1e6 },
    mainCpuPercent: (cpu.user + cpu.system) / (elapsedSeconds * 1e6) * 100,
    lastAllElectronProcessesCpuPercent: cpuPercent,
    peakRssMiB: peakRss / 1048576, bytesPerSecond: bytes / elapsedSeconds
  }))
  app.exit(0)
}).catch(() => {
  // Capture exceptions must never serialize frame-bearing objects.
  console.log(JSON.stringify({ backend: 'a', status: 'failed', error: 'capture_unavailable' }))
  app.exit(1)
})
