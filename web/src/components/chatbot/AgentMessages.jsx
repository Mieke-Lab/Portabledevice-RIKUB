import { BookOpen, FileText, MessageCircleQuestion, Plus, ShieldCheck, Sprout } from 'lucide-react';

// Rendering for the Jetson agent's replies (see api.js agentDiagnosisMeta / agentFollowupMeta).

const CONFIDENCE_TONE = {
  tinggi: 'bg-emerald-500/15 text-emerald-700',
  sedang: 'bg-amber-500/15 text-amber-700',
  rendah: 'bg-red-500/15 text-red-700',
};

// Follow-up questions offered under the newest diagnosis. Each ends in "?" so the agent
// routes it as a follow-up about the active case, not as a new diagnosis.
export const FOLLOWUP_SUGGESTIONS = [
  'Obatnya apa dan bagaimana dosisnya?',
  'Kenapa penyakit ini bisa muncul?',
  'Bagaimana cara pencegahannya?',
  'Apakah aman untuk ikan dan lingkungan sawah?',
];

function Section({ Icon, title, children }) {
  return (
    <div className="border-t border-border/70 pt-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

export function DiagnosisCard({ meta, onAsk, showSuggestions, disabled }) {
  const peng = meta.pengendalian || {};
  const tone = CONFIDENCE_TONE[String(meta.label_keyakinan || '').toLowerCase()] || 'bg-muted text-muted-foreground';
  return (
    <div className="flex max-w-[85%] flex-col gap-2.5 rounded-2xl border border-leaf/30 bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-leaf">
          {meta.mode === 'parameter' ? 'Diagnosis parameter' : 'Diagnosis'}
        </span>
        <span className="text-base font-bold text-forest">{meta.hama || '-'}</span>
        {meta.label_keyakinan && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
            keyakinan {meta.label_keyakinan}
            {meta.skor != null && ` · ${Number(meta.skor).toFixed(2)}`}
          </span>
        )}
      </div>

      {meta.narasi && <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{meta.narasi}</p>}

      {meta.pencegahan && (
        <Section Icon={Sprout} title="Pencegahan">{meta.pencegahan}</Section>
      )}

      {(peng.jenis || peng.bahan_aktif?.length || peng.contoh_produk?.length || peng.catatan) && (
        <Section Icon={ShieldCheck} title={`Pengendalian${peng.jenis ? ` · ${peng.jenis}` : ''}`}>
          {peng.bahan_aktif?.length > 0 && <div><b>Bahan aktif:</b> {peng.bahan_aktif.join(', ')}</div>}
          {peng.contoh_produk?.length > 0 && <div><b>Contoh produk:</b> {peng.contoh_produk.join(', ')}</div>}
          {peng.catatan && <div className="mt-1 text-muted-foreground">{peng.catatan}</div>}
        </Section>
      )}

      {meta.catatan && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileText className="h-3.5 w-3.5" /> Kasus tersimpan di catatan Obsidian: {meta.catatan}
        </div>
      )}

      {showSuggestions && (
        <div className="border-t border-border/70 pt-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <MessageCircleQuestion className="h-3.5 w-3.5" /> Tanya lanjutan
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOWUP_SUGGESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={disabled}
                onClick={() => onAsk(q)}
                className="rounded-full border border-leaf/30 bg-leaf/5 px-3 py-1 text-xs font-medium text-forest transition-colors hover:bg-leaf/15 disabled:pointer-events-none disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A follow-up answer: the text, plus which Obsidian notes it was grounded on.
export function FollowupBubble({ text, meta }) {
  const sources = (meta?.pengetahuan || []).filter((s) => s.skor >= 0.3);
  return (
    <div className={`max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed ${meta?.ditolak ? 'border-amber-300/60 bg-amber-50 text-amber-900' : 'border-border bg-card text-foreground'}`}>
      <div className="whitespace-pre-wrap">{text}</div>
      {!meta?.ditolak && sources.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" /> Rujukan:
          {sources.map((s) => (
            <span key={s.sumber} className="rounded-full bg-muted px-2 py-0.5" title={`kemiripan ${s.skor}`}>
              {s.sumber.replace(/^knowledge\//, '').replace(/\.md$/, '')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Which case the conversation is about, and a way to start over with new symptoms.
export function CaseBanner({ diagnosis, followups, onNewCase, disabled }) {
  if (!diagnosis) {
    return (
      <div className="mb-2 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        Belum ada kasus aktif. Tulis gejala yang terlihat di sawah untuk memulai diagnosis.
      </div>
    );
  }
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-leaf/30 bg-leaf/5 px-3 py-2 text-xs">
      <span className="font-semibold text-forest">Kasus aktif:</span>
      <span className="font-bold text-forest">{diagnosis.hama || '-'}</span>
      {diagnosis.label_keyakinan && <span className="text-muted-foreground">· keyakinan {diagnosis.label_keyakinan}</span>}
      <span className="text-muted-foreground">· {followups} tanya-jawab</span>
      <button
        type="button"
        onClick={onNewCase}
        disabled={disabled}
        className="ml-auto inline-flex items-center gap-1 rounded-full border border-leaf/40 bg-card px-2.5 py-1 font-semibold text-forest transition-colors hover:bg-leaf/10 disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Kasus baru
      </button>
    </div>
  );
}
