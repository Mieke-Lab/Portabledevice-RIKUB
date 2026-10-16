const API_URL = import.meta.env.VITE_COPILOT_API_URL;
const API_KEY = import.meta.env.VITE_COPILOT_API_KEY;
const MODEL = import.meta.env.VITE_COPILOT_MODEL ?? "gpt-4o-mini";

export const SYSTEM_PROMPT = `You are SOEROGIS AGRO-COPILOT, an expert agronomy assistant for the Bayucaraka UAV ground control station.
You answer using retrieval-augmented knowledge of agriculture, crop science and Indonesian field conditions, and you have access to a plant-disease diagnosis tool.
When the user attaches a leaf/plant photo, analyse it for disease, pest and nutrient-deficiency symptoms.
When a 7-in-1 soil sensor reading is attached, interpret temperature, moisture, pH, EC and N-P-K against the target crop and give concrete, prioritised recommendations (fertiliser type & dose, irrigation, amendments).
Be concise, practical and field-ready. Use metric units.`;

export function newId(prefix = "id") {
  return `${prefix}_${new Date().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateSoilReading() {
  const rnd = (min, max, dp = 1) => {
    const v = min + Math.random() * (max - min);
    const f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  };
  return {
    type: "soil_sensor_reading",
    device: "GCS Probe Bridge",
    sensor_model: "7-in-1 Soil Sensor",
    probe_depth_cm: 10,
    timestamp: new Date().toISOString(),
    readings: {
      temperature_c: rnd(21, 31),
      moisture_pct: rnd(18, 62),
      ph: rnd(4.8, 7.6, 2),
      ec_us_cm: Math.round(rnd(300, 2600, 0)),
      nitrogen_mg_kg: Math.round(rnd(40, 240, 0)),
      phosphorus_mg_kg: Math.round(rnd(8, 90, 0)),
      potassium_mg_kg: Math.round(rnd(60, 320, 0)),
    },
  };
}

function toApiMessages(history) {
  const mapped = history
    .filter((m) => !m.pending)
    .map((m) => {
      if (m.role === "assistant") {
        return { role: m.role, content: m.content };
      }

      const parts = [];
      if (m.content.trim()) parts.push({ type: "text", text: m.content });

      for (const att of m.attachments ?? []) {
        if (att.kind === "image" && att.dataUrl) {
          parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
        } else if (att.kind === "sensor" && att.sensor) {
          parts.push({
            type: "text",
            text: `Attached 7-in-1 soil sensor reading:\n\`\`\`json\n${JSON.stringify(att.sensor, null, 2)}\n\`\`\``,
          });
        } else if (att.kind === "file") {
          parts.push({ type: "text", text: `Attached file: ${att.name}` });
        }
      }

      if (parts.length === 1 && parts[0].type === "text") {
        return { role: m.role, content: parts[0].text };
      }
      return { role: m.role, content: parts };
    });

  return [{ role: "system", content: SYSTEM_PROMPT }, ...mapped];
}

export async function* streamChat(history, signal) {
  if (!API_URL) {
    yield* mockStream(history, signal);
    return;
  }

  try {
    const res = await fetch(`${API_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: toApiMessages(history),
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Copilot API error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* ignore keep-alive / partial frames */
        }
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    yield* mockStream(history, signal);
  }
}

async function* mockStream(history, signal) {
  const last = [...history].reverse().find((m) => m.role === "user");
  const sensor = last?.attachments?.find((a) => a.kind === "sensor")?.sensor;
  const hasImage = last?.attachments?.some((a) => a.kind === "image");

  let reply;

  if (sensor) {
    const r = sensor.readings;
    const phNote =
      r.ph < 5.5
        ? "strongly acidic — apply agricultural lime (~1.5 t/ha dolomite) to lift it toward 6.0–6.8"
        : r.ph > 7.2
          ? "alkaline — incorporate elemental sulphur or compost to bring it down"
          : "in the ideal 5.5–7.0 band for most field crops";
    const nNote =
      r.nitrogen_mg_kg < 100
        ? `Nitrogen is low (${r.nitrogen_mg_kg} mg/kg) — top-dress urea ~150 kg/ha split in two passes`
        : `Nitrogen is adequate (${r.nitrogen_mg_kg} mg/kg)`;
    const moistNote =
      r.moisture_pct < 25
        ? `Moisture is low at ${r.moisture_pct}% — schedule irrigation before the next nutrient pass`
        : `Moisture at ${r.moisture_pct}% is workable`;
    reply = `🛰️ **Soil reading received from the 7-in-1 probe.**

Here is my agronomic read-out:

- **pH ${r.ph}** — ${phNote}.
- **${nNote}.** Phosphorus ${r.phosphorus_mg_kg} mg/kg, Potassium ${r.potassium_mg_kg} mg/kg.
- **EC ${r.ec_us_cm} µS/cm** — ${r.ec_us_cm > 2000 ? "elevated salinity, leach with clean irrigation" : "salinity is healthy"}.
- **${moistNote}.**
- Soil temperature ${r.temperature_c} °C is fine for root uptake.

**Recommendation:** balance the N-P-K with a tailored blend, correct pH first, and re-probe after 2 weeks. Want a full fertiliser schedule for a specific crop?`;
  } else if (hasImage) {
    reply = `🔬 **Running plant-disease diagnosis on the attached image…**

From the leaf morphology and lesion pattern I can see, the most likely candidate is an **early-stage fungal leaf blight** (confidence ~78%). Key indicators: concentric necrotic lesions with chlorotic halos and slight leaf curl.

**Suggested action:**
1. Isolate affected plants and remove the worst leaves.
2. Apply a copper-based or mancozeb fungicide at label rate.
3. Improve canopy airflow and avoid overhead watering.

Send a 7-in-1 soil reading and I can check whether a nutrient imbalance is making the crop more susceptible.`;
  } else {
    reply = `I'm your agronomy copilot. I can pull from agricultural references, read your **7-in-1 soil sensor**, and diagnose plant disease from a photo.

Try attaching a leaf photo, or tap **Sensor → Read now** to pull a live soil profile and I'll turn it into a fertiliser plan.`;
  }

  for (const token of reply.match(/\s*\S+/g) ?? []) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 18));
    yield token;
  }
}
