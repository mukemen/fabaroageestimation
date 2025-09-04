"use client"
import { useEffect, useRef, useState } from "react"

const MODEL_BASE = "/models" // model Human disalin ke public/models via postinstall
const DETECTOR_FILES = ["blazeface-front.json", "blazeface-back.json"]

// util kecil: timeout; untuk warmup kita tidak mem-fail total
function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms)
    p.then(v => { clearTimeout(t); resolve(v) }).catch(e => { clearTimeout(t); reject(e) })
  })
}

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

  // pre-list kamera
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

  async function loadHuman() {
    // ✅ impor default dari paket (bukan dari /dist)
    const mod = await import("@vladmandic/human")
    const Human = (mod as any).default || (mod as any).Human

    // config awal (pakai WebGL dahulu)
    const baseConfig: any = {
      modelBasePath: MODEL_BASE,
      cacheSensitivity: 0,
      backend: "webgl",
      filter: { enabled: true, equalization: true },
      face: {
        enabled: true,
        detector: { rotation: true, maxDetected: 1, minConfidence: 0.2, skipFrames: 0, modelPath: DETECTOR_FILES[0] },
        mesh: { enabled: false },
        iris: { enabled: false },
        attention: { enabled: false },
        description: { enabled: false },
        gear: { enabled: true, modelPath: "gear/gear.json" }, // age/gender
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
      },
    }

    // coba dua file detektor (front/back)
    for (const det of DETECTOR_FILES) {
      try {
        setStatus(`Memuat model lokal… (${det})`)
        baseConfig.face.detector.modelPath = det
        const human = new Human(baseConfig)

        await withTimeout(human.load(), 12000) // load model

        // Warmup jangan bikin gagal total: coba WebGL → kalau timeout, fallback CPU
        try {
          await withTimeout(human.warmup(), 5000)
          setStatus("Model siap (WebGL)")
          return human
        } catch {
          try {
            await human.tf.setBackend("cpu")
            await human.tf.ready()
            await withTimeout(human.warmup(), 4000).catch(()=>{}) // abaikan jika lama
            setStatus("Model siap (CPU fallback)")
            return human
          } catch (e) {
            console.warn("Fallback CPU gagal:", e)
            // lanjut mencoba detektor berikutnya
          }
        }
      } catch (e) {
        console.warn("Gagal load model:", det, e)
      }
    }
    throw new Error("Model lokal tidak dapat dimuat (cek /models)")
  }

  async function startCam() {
    try {
      setStatus("Menyalakan kamera…")
      await ensureCamera()

      if (!(await selfTestModels())) {
        setStatus("Model TIDAK ditemukan di /models — pastikan folder public/models ikut terdeploy")
        return
      }

      setStatus("Kamera aktif — memuat model…")
      const human = await loadHuman()
      humanRef.current = human

      runningRef.current = true
      lastDetect.current = performance.now()
      const loop = () => {
        if (!runningRef.current) return
        rafRef.current = requestAnimationFrame(loop)
        const now = performance.now()
        if (now - lastDetect.current < 66) return // ~15 FPS
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
        const c = f.score ? (f.score * 100).toFixed(1) + "%" : "—"
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
