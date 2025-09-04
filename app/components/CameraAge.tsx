"use client"
import { useEffect, useRef, useState } from "react"

// Pastikan file berikut ADA di public/models:
//  - blazeface-front.json   (atau blazeface-back.json)
//  - faceres.json           (FaceRes → age)
//  - gear.json              (GEAR → age/gender)
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
  const fpsTimerRef = useRef<number>(0)
  const fpsCountRef = useRef<number>(0)

  // ---------- helpers ----------
  async function ensureCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { 
            facingMode: { ideal: "user" }, // Perbaikan untuk iOS
            width: { ideal: 1280 }, 
            height: { ideal: 720 } 
          },
      audio: false,
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    streamRef.current = stream
    const video = videoRef.current!
    video.srcObject = stream
    await new Promise<void>(res => {
      const onMeta = () => { res(); video.removeEventListener("loadedmetadata", onMeta) }
      video.addEventListener("loadedmetadata", onMeta)
    })
    await video.play()
    const canvas = canvasRef.current!
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }

  async function selfTestModels() {
    try {
      // Cek minimal 1 detektor tersedia (front OR back)
      const detectorChecks = await Promise.all(
        DETECTOR_FILES.map(file => 
          fetch(`${MODEL_BASE}/${file}`, { cache: "force-cache" }).then(r => r.ok)
        )
      );
      if (!detectorChecks.some(Boolean)) throw new Error("No detector model");

      // Cek model wajib lainnya
      const requiredModels = ["faceres.json", "gear.json"];
      const modelChecks = await Promise.all(
        requiredModels.map(file => 
          fetch(`${MODEL_BASE}/${file}`, { cache: "force-cache" }).then(r => r.ok)
        )
      );
      if (!modelChecks.every(Boolean)) throw new Error("Required models missing");
      
      return true;
    } catch (e) {
      console.error("Model self-test failed:", e);
      return false;
    }
  }

  // dynamic import supaya tidak kena SSR/bundling aneh
  async function loadHumanCPU() {
    const mod: any = await import("@vladmandic/human")
    const Human = mod.default || mod.Human

    const baseCfg: any = {
      debug: false,
      modelBasePath: MODEL_BASE,
      cacheSensitivity: 0,
      backend: "cpu",
      filter: { enabled: true, equalization: true },
      face: {
        enabled: true,
        detector: {
          rotation: true, maxDetected: 1, minConfidence: 0.2, skipFrames: 0,
          // Path akan diisi di loop
        },
        description: { enabled: true },
        gear: { enabled: true },
        mesh: { enabled: false },
        iris: { enabled: false },
        attention: { enabled: false },
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
      },
    }

    for (const det of DETECTOR_FILES) {
      try {
        setStatus(`Memuat model lokal (CPU)… (${det})`)
        
        const human = new Human({
          ...baseCfg,
          face: {
            ...baseCfg.face,
            detector: { 
              ...baseCfg.face.detector, 
              modelPath: `${MODEL_BASE}/${det}` 
            },
            description: {
              ...baseCfg.face.description,
              modelPath: `${MODEL_BASE}/faceres.json`
            },
            gear: {
              ...baseCfg.face.gear,
              modelPath: `${MODEL_BASE}/gear.json`
            }
          }
        })
        
        await human.load()
        
        // Verifikasi model benar-benar termuat
        if (!human.modelLoaded("face")) {
          throw new Error(`Detektor gagal dimuat: ${det}`);
        }
        
        setStatus(`Model siap: ${det.split('-')[1].replace('.json', '')}`)
        return human
      } catch (e) {
        console.warn("Gagal load detektor:", det, e)
      }
    }
    throw new Error("Model lokal tidak lengkap / gagal dimuat")
  }

  // ---------- lifecycle ----------
  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        s.getTracks().forEach(t => t.stop())
        const devices = await navigator.mediaDevices.enumerateDevices()
        setCameras(devices.filter(d => d.kind === "videoinput"))
      } catch (err) {
        console.error("Gagal enumerasi kamera:", err)
        setStatus("Gagal mengakses kamera. Pastikan izin diizinkan.")
      }
    })()

    // FPS counter
    fpsTimerRef.current = performance.now()
    const fpsInterval = setInterval(() => {
      const now = performance.now()
      const elapsed = now - fpsTimerRef.current
      if (elapsed > 0) {
        setFps(Math.round(fpsCountRef.current * 1000 / elapsed))
        fpsCountRef.current = 0
        fpsTimerRef.current = now
      }
    }, 1000)

    return () => {
      stopCam()
      if (fpsInterval) clearInterval(fpsInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startCam() {
    try {
      setStatus("Menyalakan kamera…")
      await ensureCamera()

      if (!(await selfTestModels())) {
        setStatus("Model TIDAK lengkap di /models (butuh: blazeface-front.json, faceres.json, gear.json)")
        stopCam()
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
        fpsCountRef.current++
        detect()
      }
      rafRef.current = requestAnimationFrame(loop)
      setStatus("Siap. Arahkan wajah ke kamera.")
    } catch (err: any) {
      stopCam()
      setStatus("Gagal: " + (err?.message || String(err)))
    }
  }

  async function detect() {
    const human = humanRef.current
    const video = videoRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")!
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

        setAge(a ? `${a} tahun` : "—")
        setConf(c)

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
    }
  }

  function stopCam() {
    runningRef.current = false
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const v = videoRef.current
    if (v?.srcObject) (v.srcObject as MediaStream).getTracks().forEach(t => t.stop())
    if (streamRef.current) { 
      streamRef.current.getTracks().forEach(t => t.stop()) 
      streamRef.current = null 
    }
    setStatus("Berhenti")
  }

  async function onChangeCamera(id: string) {
    setDeviceId(id || undefined)
    if (runningRef.current) { 
      stopCam()
      await startCam() 
    }
  }

  return (
    <main className="container" style={{ 
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      maxWidth: "800px",
      margin: "0 auto",
      padding: "20px"
    }}>
      <header className="header" style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: "12px",
        marginBottom: "20px"
      }}>
        <img src="/logo/logo-horizontal.png" alt="Fabaro Age Estimation" height={40} />
        <span style={{ 
          background: "#2563eb", 
          color: "white", 
          padding: "4px 10px",
          borderRadius: "12px",
          fontSize: "14px",
          fontWeight: "bold"
        }}>PWA</span>
      </header>

      <div style={{ 
        display: "flex", 
        gap: "10px", 
        marginBottom: "20px",
        flexWrap: "wrap"
      }}>
        <button 
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
          onClick={startCam}
        >Izinkan Kamera</button>
        
        <button 
          style={{
            background: "#dc2626",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
          onClick={stopCam}
        >Hentikan</button>
        
        <select 
          style={{
            padding: "10px 15px",
            borderRadius: "6px",
            border: "1px solid #e2e8f0",
            background: "white"
          }}
          value={deviceId}
          onChange={(e) => onChangeCamera(e.currentTarget.value)}
        >
          <option value="">Pilih kamera…</option>
          {cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Kamera ${i + 1}`}</option>)}
        </select>
        
        <span style={{
          background: "#f1f5f9",
          padding: "8px 12px",
          borderRadius: "999px",
          fontSize: "14px"
        }}>Status: {status}</span>
      </div>

      <div style={{ 
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        backgroundColor: "#000",
        borderRadius: "8px",
        overflow: "hidden",
        marginBottom: "20px"
      }}>
        <video 
          ref={videoRef} 
          playsInline 
          muted 
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover"
          }}
        />
        <canvas 
          ref={canvasRef} 
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%"
          }}
        />
        <div style={{
          position: "absolute",
          bottom: "15px",
          left: "15px",
          background: "rgba(0,0,0,0.5)",
          color: "white",
          padding: "10px",
          borderRadius: "8px",
          width: "calc(100% - 30px)"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
            <b>Perkiraan Umur:</b> <span>{age}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
            <b>Confidence:</b> <span>{conf}</span>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.2)",
            padding: "3px 8px",
            borderRadius: "6px",
            display: "inline-block",
            fontSize: "12px"
          }}>FPS: {fps || "—"}</div>
        </div>
      </div>

      <p style={{ 
        color: "#64748b",
        fontSize: "14px",
        fontStyle: "italic",
        textAlign: "center"
      }}>
        100% on-device. Setelah pertama kali online, model disimpan offline oleh Service Worker.
        Gunakan secara etis & minta persetujuan. © FABARO GROUP
      </p>
    </main>
  )
}
