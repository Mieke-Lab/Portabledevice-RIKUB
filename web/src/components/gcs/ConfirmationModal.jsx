export function ConfirmationModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDanger = false,
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative glass-panel w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-gcs-on-surface">{title}</h2>
        <p className="mt-2 text-sm text-gcs-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl border border-gcs-outline px-4 py-2 text-sm text-gcs-on-surface transition hover:bg-white/30"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-medium text-white transition ${
              isDanger
                ? "bg-gcs-error hover:bg-gcs-error/80"
                : "bg-gcs-primary hover:bg-gcs-primary/80"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
