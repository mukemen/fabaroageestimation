\"use client\"
import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window { Human?: any }
}

const HUMAN_VERSION = '3.3.6'
const MODEL_BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/human@${HUMAN_VERSION}/models`

export default function CameraAge() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Idle')
  const [age, setAge] = useState<string>('—')
  const [conf, setConf] = useState<string>('—')
  const [fps, setFps] = useState<number>(0)
  const [running, setRunning] = useState(false)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined)
  const humanRef = useRef<any>(null)
  const lastDetect = useRef<number>(0)

  useEffect(() => {
    // List cameras (labels may need prior permission)
    navigator.mediaDevices?.getUserMedia({ video: true, audio: false })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => setCameras(devices.filter(d => d.kind === 'videoinput')))
      .catch(() => {/* ignore */})
  }, [])

  async function startCam() {
    try {
      setStatus('Memuat model…')
      // @ts-ignore
      const Human = window.Human?.Human
      if (!Human) { setStatus('Human.js belum termuat. Tunggu sebentar lalu coba lagi.'); return; }
      const human = new Human({
        modelBasePath: MODEL_BASE,
        cacheSensitivity: 0,
        backend: 'webgl',
        filter: { enabled: true, equalization: true },
        face: {
          enabled: true,
          detector: { rotation: true, maxDetected: 1 },
          mesh: { enabled: false },
          iris: { enabled: false },
          attention: { enabled: false },
          description: { enabled: true }, // age & gender need this
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false }
        }
      })
      humanRef.current = human
      await human.load()
      await human.warmup()

      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      setStatus('Kamera aktif')
      setRunning(true)
      lastDetect.current = performance.now()

      // Resize canvas to video frame
      const canvas = canvasRef.current!
      const handleResize = () => {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      handleResize()

      // Use rAF with throttle (15 FPS max detection)
      const loop = () => {
        if (!running) return
        requestAnimationFrame(loop)
        const now = performance.now()
        const elapsed = now - lastDetect.current
        if (elapsed < 66) return // ~15 fps
        lastDetect.current = now
        detect()
      }
      requestAnimationFrame(loop)

    } catch (err: any) {
      setStatus('Gagal: ' + err.message)
    }
  }

  async function detect() {
    const human = humanRef.current
    const video = videoRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const t0 = performance.now()
    try {
      const result = await human.detect(video)
      // Draw video frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      if (!result?.face?.length) {
        setAge('—'); setConf('—')
      } else {
        const f = result.face[0]
        const [bx, by, bw, bh] = f.box || [0,0,0,0]
        if (bw>0 && bh>0) {
          ctx.strokeStyle = '#00d4aa'
          ctx.lineWidth = 3
          ctx.strokeRect(bx, by, bw, bh)
        }
        const a = (f.age != null) ? Math.round(f.age) : null
        const c = f.score ? (f.score * 100).toFixed(1) + '%' : '—'
        setAge(a ? `${a} tahun` : '—')
        setConf(c)
        if (a) {
          ctx.fillStyle = 'rgba(0,0,0,.6)'
          ctx.fillRect(bx, Math.max(0, by-26), 120, 24)
          ctx.fillStyle = '#fff'
          ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Arial'
          ctx.fillText(`≈ ${a} th`, bx+8, Math.max(14, by-8))
        }
      }
    } catch (e:any) {
      setStatus('Error deteksi: ' + e.message)
    } finally {
      const dt = performance.now() - t0
      setFps(Math.max(1, Math.round(1000 / dt)))
    }
  }

  function stopCam() {
    const video = videoRef.current
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(t => t.stop())
    }
    setRunning(false)
    setStatus('Berhenti')
  }

  return (
    <main className=\"container\">
      <header className=\"header\">
        <div className=\"dot\" /><h1 style={{margin:0,fontSize:18}}>Fabaro Age Estimation <span className=\"badge\">PWA</span></h1>
      </header>

      <div className=\"row\">
        <button className=\"btn\" onClick={startCam} disabled={running}>Izinkan Kamera</button>
        <button className=\"btn\" onClick={stopCam} disabled={!running}>Hentikan</button>
        <select className=\"btn\" value={deviceId} onChange={(e)=>setDeviceId(e.currentTarget.value)}>
          <option value=\"\">Pilih kamera…</option>
          {cameras.map((c,i)=>(<option key={c.deviceId} value={c.deviceId}>{c.label || `Kamera ${i+1}`}</option>))}
        </select>
        <span className=\"pill\">Status: {status}</span>
      </div>

      <div className=\"wrap\">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className=\"hud\">
          <div><b>Perkiraan Umur:</b> <span>{age}</span></div>
          <div><b>Confidence:</b> <span>{conf}</span></div>
          <div className=\"pill\">FPS: {fps || '—'}</div>
        </div>
      </div>

      <p className=\"footer\">
        100% on-device. Setelah pertama kali online, model disimpan offline oleh Service Worker biar lancar.
        Gunakan secara etis dan minta persetujuan. © FABARO GROUP
      </p>
    </main>
  )
}
