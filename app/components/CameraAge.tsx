"use client"
import { useEffect, useRef, useState } from "react"

// Model Human disajikan dari domain sendiri (public/models)
const MODEL_BASE = "/models"
const DETECTOR_FILES = ["blazeface-front.json", "blazeface-back.json"]

export default function CameraAge() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [status, setStatus] = useState("Idle")
  const [age, setAge] = useState<string>("—")
  const [conf, setConf] = useState<string>("—")
  const [fps, setFps] = useState<number>(0)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined)

  const humanRef = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const runningRef = useRef<boolean>(false)
  const rafRef = useRef<number | null>(null)
  const lastDetect = useRef<number>(0)

  // -------- Helpers
  async function ensureCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    const constraints: MediaStreamConstraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } :
        { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    streamRef.current = stream
    const video = videoRef.current!
    video.srcObject = stream
    await new Promise<void>(res => { const onMeta = () => { res(); video.removeEventListener("loadedmetadata", onMeta) }; video.addEventListener("loadedmetadata", onMeta) })
    await video.play()
    const canvas = canvasRef.current!
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }

  async function selfTestModels() {
    try {
      const a = await fetch("/models/gear/gear.json", { cache: "no-store" })
      const b = await fetch("/models/blazeface-front.json", { cache: "no-store" })
      if (!a.ok || !b.ok) throw new Error("404")
      return true
    } catch { return false }
  }

  async function loadHumanCPU() {
    // ❗ import dari paket (paket ini tidak punya tipe TS → kita treat as any)
    const mod: any = await import("@vladmandic/human")
    const Human = mod.default || mod.Human

    // Gunakan backend CPU (paling stabil di semua HP), tanpa warmup
    const cfg: any = {
      debug: false,
      modelBasePath: MODEL_BASE,
      cacheSensitivity: 0,
      backend: "cpu",
      filter: { enabled: true, equalization: true },
      face: {
        enabled: true,
        detector: { rotation: true, maxDetected: 1, minConfidence: 0.2, skipFrames: 0, modelPath: DETECTOR_FILES[0] },
        mesh: { enabled: false },
        iris: { enabled: false },
        attention: { enabled: false },
        description: { enabled: false },
        gear: { enabled: true, modelPath: "gear/gear.json" }, // umur/gender
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
      },
    }

    for (const det of DETECTOR_FILES) {
      try {
        cfg.face.detector.modelPath = det
        setStatus(`Memuat model lokal (CPU)… (${det})`)
        const human = new Human(cfg)
        await human.load() // muat semua model
        setStatus("Model siap (CPU)")
        return human
      } catch (e) {
        console.warn("Gagal load detektor:", det, e)
      }
    }
    throw new Error("Model lokal tidak ditemukan / gagal dimuat")
  }

  // -------- Lifecycle
  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        s.getTracks().forEach(t => t.stop())
        const devices = await navigator.mediaDevices.enumerateDevices()
        setCameras(devices.filter(d => d.kind === "videoinput"))
      } catch {}
    })()
    return () => stopCam()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startCam() {
    try {
      setStatus("Menyalakan kamera…"); await ensureCamera()

      if (!(await selfTestModels())) {
        setStatus("Model TIDAK ada di /models — pastikan folder public/models ikut terdeploy")
        return
      }

      setStatus("Kamera aktif — memuat model…")
      const human = await loadHumanCPU()
      humanRef.current = human

      runningRef.current = true
      lastDetect.current = performance.now()
      const loop = () => {
        if (!runningRef.current) return
        rafRef.current = requestAnimationFrame(loop)
        const now = performance.now()
        if (now - lastDetect.current < 100) return // ~10 FPS (CPU)
        lastDetect.current = now
        detect()
      }
      rafRef.current = requestAnimationFrame(loop)
      setStatus("Siap. Arahkan wajah ke kamera.")
    } catch (err: any) {
      setStatus("Gagal: " + (err?.message || String(err)))
    }
  }

  async function detect() {
    const human = humanRef.current
    const video = videoRef.current!, canvas = canvasRef.current!, ctx = canvas.getContext("2d")!
    const t0 = performance.now()
    try {
      const result = await human.detect(video)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      if (!result?.face?.length) {
        setAge("—"); setConf("—")
      } else {
        const f = result.face[0]
        const [bx, by, bw, bh] = f.box || [0,0,0,0]
        if (bw>0 && bh>0) { ctx.strokeStyle = "#00d4aa"; ctx.lineWidth = 3; ctx.strokeRect(bx,by,bw,bh) }
        const a = (f.age != null) ? Math.round(f.age) : null
        const score = (f.faceScore ?? f.boxScore ?? f.score ?? 0) as number
        const c = score ? (score * 100).toFixed(1) + "%" : "—"
        setAge(a ? `${a} tahun` : "—"); setConf(c)
        if (a) {
          ctx.fillStyle = "rgba(0,0,0,.6)"
          ctx.fillRect(bx, Math.max(0, by-26), 120, 24)
          ctx.fillStyle = "#fff"
          ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial"
          ctx.fillText(`≈ ${a} th`, bx+8, Math.max(14, by-8))
        }
      }
    } catch (e:any) {
      setStatus("Error deteksi: " + (e?.message || String(e)))
    } finally {
      const dt = performance.now() - t0
      setFps(Math.max(1, Math.round(1000/dt)))
    }
  }

  function stopCam() {
    runningRef.current = false
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const v = videoRef.current
    if (v?.srcObject) (v.srcObject as MediaStream).getTracks().forEach(t => t.stop())
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    setStatus("Berhenti")
  }

  async function onChangeCamera(id: string) {
    setDeviceId(id || undefined)
    if (runningRef.current) { stopCam(); await startCam() }
  }

  return (
    <main className="container">
      <header className="header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src="/logo/logo-horizontal.png" alt="Fabaro Age Estimation" height={40} />
        <span className="badge">PWA</span>
      </header>

      <div className="row">
        <button className="btn" onClick={startCam}>Izinkan Kamera</button>
        <button className="btn" onClick={stopCam}>Hentikan</button>
        <select className="btn" value={deviceId} onChange={(e) => onChangeCamera(e.currentTarget.value)}>
          <option value="">Pilih kamera…</option>
          {cameras.map((c,i)=> <option key={c.deviceId} value={c.deviceId}>{c.label || `Kamera ${i+1}`}</option>)}
        </select>
        <span className="pill">Status: {status}</span>
      </div>

      <div className="wrap">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className="hud">
          <div><b>Perkiraan Umur:</b> <span>{age}</span></div>
          <div><b>Confidence:</b> <span>{conf}</span></div>
          <div className="pill">FPS: {fps || "—"}</div>
        </div>
      </div>

      <p className="footer">
        100% on-device. Setelah pertama kali online, model disimpan offline oleh Service Worker.
        Gunakan secara etis & minta persetujuan. © FABARO GROUP
      </p>
    </main>
  )
}
