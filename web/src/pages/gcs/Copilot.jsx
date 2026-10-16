import { useEffect, useMemo, useRef, useState } from "react";
import { CameraCaptureModal } from "@/components/gcs/CameraCaptureModal";
import { SensorReadModal } from "@/components/gcs/SensorReadModal";
import { SensorReadingCard } from "@/components/gcs/SensorReadingCard";
import { generateSoilReading, newId, streamChat } from "@/lib/gcs/copilot";

const WELCOME = {
  id: "welcome",
  role: "assistant",
  content:
    "👋 I'm your **Agro-Copilot**. Ask me anything about crops and soil, attach a leaf photo for a disease diagnosis, or tap **Sensor** to pull a live reading from the 7-in-1 soil probe.",
};

const INITIAL_CONVERSATIONS = [
  {
    id: "c_demo_1",
    title: "Blight on chili leaves",
    updatedAt: "2026-06-02T09:12:00Z",
    messages: [WELCOME],
  },
  {
    id: "c_demo_2",
    title: "Sector 07-B soil profile",
    updatedAt: "2026-05-31T14:40:00Z",
    messages: [WELCOME],
  },
];

const SUGGESTIONS = [
  { icon: "biotech", text: "Diagnose disease from a leaf photo" },
  { icon: "sensors", text: "Read the soil and plan fertiliser" },
  { icon: "water_drops", text: "Best irrigation schedule for chili?" },
  { icon: "pest_control", text: "Identify pests damaging my crop" },
];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function renderRich(text) {
  return text.split("\n").map((line, i) => {
    const bullet = /^\s*[-*]\s+/.test(line);
    const content = line.replace(/^\s*[-*]\s+/, "");
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      seg.startsWith("**") && seg.endsWith("**") ? (
        <strong key={j} className="font-semibold">
          {seg.slice(2, -2)}
        </strong>
      ) : (
        <span key={j}>{seg}</span>
      ),
    );
    return (
      <p
        key={i}
        className={
          bullet
            ? "pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-gcs-primary"
            : line.trim() === ""
              ? "h-2"
              : ""
        }
      >
        {parts}
      </p>
    );
  });
}

export function Copilot() {
  const [conversations, setConversations] = useState(INITIAL_CONVERSATIONS);
  const [activeId, setActiveId] = useState(INITIAL_CONVERSATIONS[0].id);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [sensorOpen, setSensorOpen] = useState(false);

  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );
  const messages = useMemo(() => active?.messages ?? [], [active]);
  const showEmptyState = messages.length <= 1 && !isStreaming;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchActive = (updater) => {
    setConversations((prev) => prev.map((c) => (c.id === activeId ? updater(c) : c)));
  };

  const newChat = () => {
    if (isStreaming) return;
    const conv = {
      id: newId("c"),
      title: "New chat",
      updatedAt: new Date().toISOString(),
      messages: [WELCOME],
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setInput("");
    setAttachments([]);
    setSidebarOpen(false);
  };

  const selectChat = (id) => {
    if (isStreaming) return;
    setActiveId(id);
    setSidebarOpen(false);
  };

  const handleFiles = async (files, forceImage = false) => {
    if (!files) return;
    const next = [];
    for (const file of Array.from(files)) {
      const isImage = forceImage || file.type.startsWith("image/");
      next.push({
        id: newId("att"),
        kind: isImage ? "image" : "file",
        name: file.name,
        mime: file.type,
        size: file.size,
        dataUrl: await readFileAsDataUrl(file),
      });
    }
    setAttachments((prev) => [...prev, ...next]);
  };

  const addCameraPhoto = (dataUrl) => {
    setAttachments((prev) => [
      ...prev,
      {
        id: newId("att"),
        kind: "image",
        name: `capture-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.jpg`,
        mime: "image/jpeg",
        dataUrl,
      },
    ]);
  };

  const addSensorReading = () => {
    setAttachments((prev) => [
      ...prev.filter((a) => a.kind !== "sensor"),
      { id: newId("att"), kind: "sensor", name: "soil-reading.json", sensor: generateSoilReading() },
    ]);
    setSensorOpen(false);
  };

  const removeAttachment = (id) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !isStreaming;

  const send = async () => {
    if (!canSend) return;

    const userMsg = {
      id: newId("m"),
      role: "user",
      content: input.trim(),
      attachments: attachments.length ? attachments : undefined,
    };
    const assistantMsg = {
      id: newId("m"),
      role: "assistant",
      content: "",
      pending: true,
    };

    const titleSeed =
      input.trim() ||
      (attachments.some((a) => a.kind === "sensor")
        ? "Soil sensor reading"
        : attachments.some((a) => a.kind === "image")
          ? "Plant photo diagnosis"
          : "New chat");

    patchActive((c) => ({
      ...c,
      title: c.title === "New chat" ? titleSeed.slice(0, 40) : c.title,
      updatedAt: new Date().toISOString(),
      messages: [...c.messages, userMsg, assistantMsg],
    }));

    const history = [...messages, userMsg];
    setInput("");
    setAttachments([]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let acc = "";
      for await (const delta of streamChat(history, controller.signal)) {
        acc += delta;
        patchActive((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: acc, pending: false } : m,
          ),
        }));
      }
      if (!acc) {
        patchActive((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: "(no response)", pending: false, error: true }
              : m,
          ),
        }));
      }
    } catch {
      patchActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: "Something went wrong reaching the copilot.", pending: false, error: true }
            : m,
        ),
      }));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const onComposerKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-[calc(100vh-128px)] gap-4 -m-1">
      <CameraCaptureModal isOpen={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={addCameraPhoto} />
      <SensorReadModal isOpen={sensorOpen} onClose={() => setSensorOpen(false)} onRead={addSensorReading} />

      {/* Chat history sidebar */}
      <aside
        className={`glass-panel rounded-2xl flex flex-col w-72 shrink-0 overflow-hidden ${
          sidebarOpen
            ? "fixed inset-y-20 left-4 z-40 w-72 shadow-2xl lg:static lg:inset-auto lg:z-auto lg:shadow-none flex"
            : "hidden lg:flex"
        }`}
      >
        <div className="p-4 border-b border-gcs-outline/20">
          <button
            onClick={newChat}
            className="w-full flex items-center justify-center gap-2 bg-gcs-primary text-white py-3 rounded-lg font-headline text-lg shadow-lg hover:bg-gcs-primary/90 transition-all active:scale-95 disabled:opacity-50"
            disabled={isStreaming}
          >
            <span className="material-symbols-outlined">add_comment</span>
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
          <p className="font-technical text-[11px] uppercase text-gcs-muted/60 px-2 mb-1">History</p>
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => selectChat(c.id)}
              className={`text-left px-3 py-2.5 rounded-lg transition-all group ${
                c.id === activeId
                  ? "bg-gcs-primary/10 border-l-4 border-gcs-primary"
                  : "hover:bg-gcs-primary/5 border-l-4 border-transparent"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`material-symbols-outlined text-lg ${
                    c.id === activeId ? "text-gcs-primary" : "text-gcs-muted/60"
                  }`}
                >
                  forum
                </span>
                <span
                  className={`font-data text-sm truncate flex-1 ${
                    c.id === activeId ? "text-gcs-primary font-semibold" : "text-gcs-on-surface"
                  }`}
                >
                  {c.title}
                </span>
              </div>
              <span className="font-technical text-[10px] text-gcs-muted/50 ml-7">
                {relativeTime(c.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Chat panel */}
      <section className="glass-panel rounded-2xl flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gcs-outline/20 bg-white/30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gcs-muted hover:text-gcs-primary"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <div className="w-9 h-9 rounded-lg bg-gcs-primary flex items-center justify-center text-white shrink-0">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
              robot_2
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="font-headline text-xl text-gcs-primary uppercase leading-none truncate">
              Agro-Copilot
            </h1>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
          {showEmptyState ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-gcs-primary/10 flex items-center justify-center text-gcs-primary mb-5">
                <span
                  className="material-symbols-outlined text-4xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  eco
                </span>
              </div>
              <h2 className="font-headline text-3xl text-gcs-primary uppercase mb-2">
                How can I help your crop?
              </h2>
              <p className="font-data text-gcs-muted mb-8">
                Field-ready agronomy answers, soil interpretation and disease diagnosis.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => setInput(s.text)}
                    className="flex items-center gap-3 text-left p-4 glass-panel rounded-xl hover:bg-white transition-all border-2 border-transparent hover:border-gcs-primary/30"
                  >
                    <span className="material-symbols-outlined text-gcs-primary">{s.icon}</span>
                    <span className="font-data text-sm text-gcs-on-surface">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5 max-w-3xl mx-auto">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-gcs-outline/20 bg-white/40 p-3 md:p-4">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {attachments.map((att) =>
                att.kind === "sensor" && att.sensor ? (
                  <SensorReadingCard
                    key={att.id}
                    payload={att.sensor}
                    variant="compact"
                    onRemove={() => removeAttachment(att.id)}
                  />
                ) : (
                  <AttachmentChip key={att.id} att={att} onRemove={() => removeAttachment(att.id)} />
                ),
              )}
            </div>
          )}

          <div className="glass-panel rounded-2xl p-2 flex items-end gap-2 border border-gcs-outline/30 focus-within:border-gcs-primary transition-colors">
            <div className="flex items-center gap-1 pb-1">
              <ToolButton icon="attach_file" title="Attach file" onClick={() => fileInputRef.current?.click()} />
              <ToolButton icon="photo_camera" title="Take a photo" onClick={() => setCameraOpen(true)} />
              <ToolButton icon="sensors" title="Read soil sensor" onClick={() => setSensorOpen(true)} />
            </div>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Ask about your crop, soil or a plant disease…"
              rows={1}
              className="flex-1 resize-none bg-transparent py-2.5 px-1 font-data text-gcs-on-surface placeholder:text-gcs-muted/50 focus:outline-none max-h-32"
            />

            {isStreaming ? (
              <button
                onClick={stop}
                className="shrink-0 w-11 h-11 rounded-xl bg-gcs-error text-white flex items-center justify-center shadow-lg hover:bg-gcs-error/90 transition-all active:scale-95"
                title="Stop"
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  stop
                </span>
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!canSend}
                className="shrink-0 w-11 h-11 rounded-xl bg-gcs-primary text-white flex items-center justify-center shadow-lg hover:bg-gcs-primary/90 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Send"
              >
                <span className="material-symbols-outlined">send</span>
              </button>
            )}
          </div>
          <p className="font-technical text-[10px] text-gcs-muted/50 text-center mt-2">
            Copilot can make mistakes. Verify critical agronomic decisions in the field.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </section>
    </div>
  );
}

function ToolButton({ icon, title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-10 h-10 rounded-xl flex items-center justify-center text-gcs-muted hover:bg-gcs-primary/10 hover:text-gcs-primary transition-all active:scale-90"
    >
      <span className="material-symbols-outlined">{icon}</span>
    </button>
  );
}

function AttachmentChip({ att, onRemove }) {
  return (
    <div className="relative group">
      {att.kind === "image" && att.dataUrl ? (
        <img
          src={att.dataUrl}
          alt={att.name}
          className="w-20 h-20 object-cover rounded-xl border-2 border-white/60 shadow"
        />
      ) : (
        <div className="w-44 h-20 px-3 rounded-xl border-2 border-white/60 bg-white/60 shadow flex items-center gap-2">
          <span className="material-symbols-outlined text-gcs-primary text-2xl">description</span>
          <span className="font-data text-xs text-gcs-on-surface truncate">{att.name}</span>
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gcs-error text-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Remove attachment"
      >
        <span className="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-white ${
          isUser ? "bg-gcs-muted" : "bg-gcs-primary"
        }`}
      >
        <span
          className="material-symbols-outlined text-xl"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {isUser ? "person" : "robot_2"}
        </span>
      </div>

      <div className={`flex flex-col gap-2 max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
        {message.attachments?.map((att) =>
          att.kind === "sensor" && att.sensor ? (
            <SensorReadingCard key={att.id} payload={att.sensor} variant="full" />
          ) : att.kind === "image" && att.dataUrl ? (
            <img
              key={att.id}
              src={att.dataUrl}
              alt={att.name}
              className="max-w-xs rounded-xl border-2 border-white/60 shadow"
            />
          ) : (
            <div
              key={att.id}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/60 border border-gcs-outline/30"
            >
              <span className="material-symbols-outlined text-gcs-primary">description</span>
              <span className="font-data text-sm text-gcs-on-surface truncate max-w-[200px]">
                {att.name}
              </span>
            </div>
          ),
        )}

        {(message.content || message.pending) && (
          <div
            className={`px-4 py-3 rounded-2xl font-data text-[15px] leading-relaxed space-y-1 ${
              isUser
                ? "bg-gcs-primary text-white rounded-tr-sm"
                : message.error
                  ? "bg-gcs-error/10 text-gcs-error border border-gcs-error/30 rounded-tl-sm"
                  : "glass-panel text-gcs-on-surface rounded-tl-sm"
            }`}
          >
            {message.pending && !message.content ? (
              <TypingDots />
            ) : (
              renderRich(message.content)
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-gcs-primary/60 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}
