"use client"
import { useEffect, useRef, useState } from "react"

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
    try {
      // Hentikan stream sebelumnya jika ada
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }

      // Cek apakah kita menggunakan HTTPS
      if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        throw new Error("Akses kamera hanya tersedia melalui HTTPS (kecuali localhost)")
      }

      // Konfigurasi kamera yang lebih fleksibel
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { 
              facingMode: { ideal: "user" },
              width: { min: 640, ideal: 1280 },
              height: { min: 480, ideal: 720 }
            },
        audio: false,
      }

      // Dapatkan stream kamera
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      
      // Tampilkan di video element
      const video = videoRef.current!
      video.srcObject = stream
      
      // Tunggu metadata video
      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          video.removeEventListener("loadedmetadata", onLoaded)
          resolve()
        }
        const onError = (e: any) => {
          video.removeEventListener("loadedmetadata", onLoaded)
          video.removeEventListener("error", onError)
          reject(new Error(`Gagal memuat metadata video: ${e.message}`))
        }
        
        video.addEventListener("loadedmetadata", onLoaded)
        video.addEventListener("error", onError)
      })
      
      // Mainkan video
      await video.play().catch(e => {
        if (e.name === 'NotSupportedError') {
          throw new Error("Format video tidak didukung oleh browser")
        }
        throw new Error(`Gagal memutar video: ${e.message}`)
      })
      
      // Sesuaikan ukuran canvas
      const canvas = canvasRef.current!
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      
      setStatus("Kamera aktif")
      return true
    } catch (err: any) {
      console.error("Error kamera:", err)
      
      // Tangani error spesifik
      if (err.name === 'NotAllowedError') {
        setStatus("Izin kamera ditolak. Silakan izinkan akses kamera di pengaturan browser.")
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setStatus("Tidak ada kamera yang ditemukan pada perangkat ini.")
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setStatus("Kamera sedang digunakan oleh aplikasi lain.")
      } else if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
        setStatus("Resolusi kamera tidak didukung. Mencoba konfigurasi alternatif...")
        // Coba dengan konfigurasi minimal
        const constraints: MediaStreamConstraints = {
          video: { width: { min: 640 }, height: { min: 480 } },
          audio: false
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints)
          streamRef.current = stream
          const video = videoRef.current!
          video.srcObject = stream
          await video.play()
          setStatus("Kamera aktif dengan resolusi dasar")
        } catch (e) {
          setStatus("Gagal mengakses kamera dengan konfigurasi dasar.")
        }
      } else if (err.message.includes("HTTPS")) {
        setStatus("Akses kamera hanya tersedia melalui HTTPS (kecuali localhost). Silakan akses melalui https://")
      } else {
        setStatus(`Error kamera: ${err.message || 'Kesalahan tidak diketahui'}`)
      }
      
      stopCam()
      return false
    }
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

  async function loadHumanCPU() {
    try {
      setStatus("Memuat library deteksi wajah...")
      
      // Menghindari analisis statis Webpack dengan menggabungkan string
      const packageName = '@vl' + 'admandic/human';
      const mod: any = await import(/* webpackIgnore: true */ packageName);
      const Human = mod.default || mod.Human;

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
          setStatus(`Memuat model detektor: ${det}`)
          
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
    } catch (err) {
      console.error("Error kritis saat memuat Human.js:", err);
      setStatus(`Gagal memuat model: ${err instanceof Error ? err.message : String(err)}`);
      throw new Error("Gagal memuat library deteksi wajah. Pastikan model tersedia di /models.");
    }
  }

  // ---------- lifecycle ----------
  useEffect(() => {
    (async () => {
      try {
        // Cek HTTPS untuk non-localhost
        if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          setStatus("Peringatan: Akses kamera hanya tersedia melalui HTTPS (kecuali localhost). Silakan akses melalui https://");
        }
        
        // Enumerasi kamera
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = devices.filter(d => d.kind === "videoinput")
        setCameras(videoDevices)
        
        if (videoDevices.length === 0) {
          setStatus("Tidak ada kamera yang ditemukan pada perangkat ini.")
        }
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
      setStatus("Mengecek kamera...")
      
      // Pastikan kita menggunakan HTTPS (kecuali localhost)
      if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        setStatus("Akses kamera hanya tersedia melalui HTTPS (kecuali localhost). Silakan akses melalui https://")
        return
      }
      
      const cameraReady = await ensureCamera()
      if (!cameraReady) return

      setStatus("Memeriksa model...")
      if (!(await selfTestModels())) {
        setStatus("Model TIDAK lengkap di /models (butuh: blazeface-front.json, faceres.json, gear.json)")
        stopCam()
        return
      }

      setStatus("Memuat model AI...")
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
      console.error("Error startCam:", err)
      stopCam()
      setStatus("Gagal memulai: " + (err?.message || String(err)))
    }
  }

  async function detect() {
    const human = humanRef.current
    const video = videoRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")!
    
    if (!ctx) {
      setStatus("Gagal mendapatkan konteks canvas")
      return
    }

    try {
      const result = await human.detect(video)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      if (!result?.face?.length) {
        setAge("—"); setConf("—")
      } else {
        const f = result.face[0]
        const [bx, by, bw, bh] = f.box || [0,0,0,0]
        if (bw>0 && bh>0) { 
          ctx.strokeStyle = "#00d4aa"; 
          ctx.lineWidth = 3; 
          ctx.strokeRect(bx,by,bw,bh) 
        }

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
      console.error("Error deteksi:", e)
      setStatus("Error deteksi: " + (e?.message || String(e)))
    }
  }

  function stopCam() {
    runningRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const v = videoRef.current
    if (v?.srcObject) {
      (v.srcObject as MediaStream).getTracks().forEach(t => t.stop())
      v.srcObject = null
    }
    if (streamRef.current) { 
      streamRef.current.getTracks().forEach(t => t.stop()) 
      streamRef.current = null 
    }
    setStatus("Kamera dimatikan")
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
      maxWidth: "100%",
      margin: "0 auto",
      padding: "10px",
      backgroundColor: "#1a1a1a",
      color: "#e6e6e6"
    }}>
      <header className="header" style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: "12px",
        borderBottom: "1px solid #2d2d2d",
        paddingBottom: "8px",
        marginBottom: "15px"
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
        flexWrap: "wrap",
        gap: "10px",
        marginBottom: "20px"
      }}>
        <button 
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            padding: "12px 24px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
            flex: 1
          }}
          onClick={startCam}
        >Izinkan Kamera</button>
        
        <button 
          style={{
            background: "#dc2626",
            color: "white",
            border: "none",
            padding: "12px 24px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
            flex: 1
          }}
          onClick={stopCam}
        >Hentikan</button>
        
        <select 
          style={{
            padding: "12px 15px",
            borderRadius: "8px",
            border: "1px solid #4a4a4a",
            background: "#2d2d2d",
            color: "white",
            flex: 1,
            minWidth: "150px"
          }}
          value={deviceId}
          onChange={(e) => onChangeCamera(e.currentTarget.value)}
        >
          <option value="">Pilih kamera…</option>
          {cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Kamera ${i + 1}`}</option>)}
        </select>
        
        <span style={{
          background: "#4a4a4a",
          padding: "8px 12px",
          borderRadius: "999px",
          fontSize: "14px",
          color: "white"
        }}>Status: {status}</span>
      </div>

      <div style={{ 
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        backgroundColor: "#000",
        borderRadius: "12px",
        overflow: "hidden",
        marginBottom: "20px",
        boxShadow: "0 0 10px rgba(0,0,0,0.5)"
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
          width: "calc(100% - 30px)",
          fontSize: "16px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
            <b>Perkiraan Umur:</b> <span>{age}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
            <b>Confidence:</b> <span>{conf}</span>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.2)",
            padding: "5px 12px",
            borderRadius: "6px",
            display: "inline-block",
            fontSize: "14px"
          }}>FPS: {fps || "—"}</div>
        </div>
      </div>

      <p style={{ 
        color: "#999",
        fontSize: "14px",
        fontStyle: "italic",
        textAlign: "center",
        marginBottom: "15px"
      }}>
        100% on-device. Setelah pertama kali online, model disimpan offline oleh Service Worker.
        Gunakan secara etis & minta persetujuan. © FABARO GROUP
      </p>
      
      <div style={{
        padding: "15px",
        background: "#fff5c7",
        border: "1px solid #facc15",
        borderRadius: "12px",
        fontSize: "14px",
        color: "#4a4a4a",
        marginBottom: "20px"
      }}>
        <h3 style={{ margin: "0 0 10px", color: "#e67e22" }}>Panduan Penggunaan</h3>
        <ul style={{ margin: "5px 0", paddingLeft: "20px" }}>
          <li>Gunakan HTTPS untuk mengakses halaman ini (kecuali localhost)</li>
          <li>Pastikan Anda telah memberikan izin akses kamera di browser</li>
          <li>Jika kamera tidak berfungsi, coba refresh halaman dan izinkan kembali</li>
          <li>Untuk perangkat iOS, pastikan Anda menggunakan Safari terbaru</li>
        </ul>
      </div>
    </main>
  )
}
