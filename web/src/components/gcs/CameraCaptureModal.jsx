import { useEffect, useRef, useState } from "react";

export function CameraCaptureModal({ isOpen, onClose, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setHasCamera(true);
        setError(null);
      })
      .catch(() => {
        if (active) {
          setHasCamera(false);
          setError("Camera unavailable — use file upload instead.");
        }
      });
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(dataUrl);
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onCapture(ev.target.result);
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-gcs-on-surface">Capture Plant Image</h2>

        {hasCamera ? (
          <div className="overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-60 w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-gcs-outline bg-gcs-bg text-center">
            <p className="text-sm text-gcs-muted">{error ?? "Initialising camera…"}</p>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          {hasCamera && (
            <button
              onClick={capture}
              className="flex-1 rounded-xl bg-gcs-primary py-2.5 text-sm font-semibold text-white transition hover:bg-gcs-primary/80"
            >
              📸 Capture
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-1 rounded-xl border border-gcs-outline py-2.5 text-sm text-gcs-on-surface transition hover:bg-white/30"
          >
            📁 Upload file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-xl border border-gcs-outline py-2 text-sm text-gcs-muted transition hover:bg-white/20"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
