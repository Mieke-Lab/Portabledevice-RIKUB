import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Fuse from "fuse.js";
import { MapCard } from "@/components/gcs/MapCard";
import { fetchJobs, createJobFromFolder } from "@/lib/gcs/api";

const STATUS_MAP = {
  uploading: "queued",
  unstitched: "queued",
  stitching: "in progress",
  clustering: "in progress",
  ready: "ready",
  failed: "error",
  canceled: "error",
};

function jobToMapData(job) {
  return {
    id: job.id || job.job_id,
    title: job.name || job.area_name || job.id || job.job_id,
    date: job.created_at ? job.created_at.slice(0, 10) : "",
    area: job.area_m2 != null ? (job.area_m2 / 10_000).toFixed(2) : "—",
    status: STATUS_MAP[job.status] ?? "queued",
  };
}

export function Mapping() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadJobs = useCallback(async () => {
    try {
      const jobs = await fetchJobs();
      setMaps(jobs.map(jobToMapData));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function tick() {
      try {
        const jobs = await fetchJobs();
        if (!active) return;
        setMaps(jobs.map(jobToMapData));
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load jobs");
      } finally {
        if (active) setLoading(false);
      }
    }
    tick();
    const timer = setInterval(tick, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const handleCreateFromFolder = async () => {
    const sourceDir = window.prompt("Server-side image folder path for the ODM job:");
    if (!sourceDir) return;
    const imageGlob = window.prompt("Optional image filter glob (e.g. *_D.JPG), or leave blank:")?.trim() || undefined;
    setIsCreateModalOpen(false);
    try {
      await createJobFromFolder(sourceDir.trim(), { imageGlob });
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create job");
    }
  };

  const fuse = useMemo(() => new Fuse(maps, { keys: ["title"], threshold: 0.4 }), [maps]);

  const sortedAndFilteredMaps = useMemo(() => {
    let results = maps;
    if (search.trim() !== "") {
      try {
        const regex = new RegExp(search, "i");
        const regexResults = maps.filter((m) => regex.test(m.title));
        results = regexResults.length > 0 ? regexResults : fuse.search(search).map((r) => r.item);
      } catch {
        results = fuse.search(search).map((r) => r.item);
      }
    }
    results = results.filter((m) => statusFilter === "all" || m.status === statusFilter);
    return [...results].sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return sortBy === "newest" ? db - da : da - db;
    });
  }, [search, statusFilter, sortBy, fuse, maps]);

  return (
    <div className="flex flex-col gap-8">
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsCreateModalOpen(false)}
          />
          <div className="glass-panel w-full max-w-2xl rounded-2xl p-8 shadow-2xl relative animate-in zoom-in-95 duration-200 border-2 border-white/50 bg-white/90">
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-headline text-2xl text-gcs-primary uppercase">Initialize New Job</h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-gcs-muted hover:text-gcs-primary transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button
                className="group flex flex-col items-center text-center p-8 glass-panel rounded-xl hover:bg-white transition-all border-2 border-transparent hover:border-gcs-primary/30"
                onClick={handleCreateFromFolder}
              >
                <div className="w-16 h-16 bg-gcs-primary/10 rounded-full flex items-center justify-center text-gcs-primary mb-4 group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-4xl">folder_open</span>
                </div>
                <h3 className="font-headline text-xl text-gcs-primary uppercase mb-2">From Folder</h3>
                <p className="font-data text-sm text-gcs-muted leading-relaxed">
                  Run an OpenDroneMap photogrammetry job on a captured-image folder on the GCS host.
                </p>
              </button>

              <button
                className="group flex flex-col items-center text-center p-8 glass-panel rounded-xl hover:bg-white transition-all border-2 border-transparent hover:border-gcs-primary/30"
                onClick={() => { navigate("/drone-dashboard/mapping/new"); setIsCreateModalOpen(false); }}
              >
                <div className="w-16 h-16 bg-gcs-secondary-fixed/20 rounded-full flex items-center justify-center text-gcs-secondary mb-4 group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-4xl">rocket_launch</span>
                </div>
                <h3 className="font-headline text-xl text-gcs-primary uppercase mb-2">From Flight</h3>
                <p className="font-data text-sm text-gcs-muted leading-relaxed">
                  Plan a new UAV mission. Define mapping areas, obstacles, and generate optimized flight paths.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-4xl text-gcs-primary uppercase tracking-tight mb-2">
            Mapping Repository
          </h1>
          <p className="font-data text-lg text-gcs-muted">
            Manage and analyze historical UAV flight jobs
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-3 bg-gcs-primary text-white px-8 py-4 rounded-lg font-headline text-xl shadow-lg hover:shadow-blue-900/20 transition-all active:scale-95 cursor-pointer"
        >
          <span className="material-symbols-outlined">add_location</span>
          Create New Job
        </button>
      </div>

      {error && (
        <div className="glass-panel rounded-xl p-4 border-2 border-gcs-error/30 flex items-center gap-3 text-gcs-error">
          <span className="material-symbols-outlined">error</span>
          <span className="font-data text-sm">{error}</span>
        </div>
      )}

      <div className="glass-panel p-4 rounded-xl flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gcs-muted">
            search
          </span>
          <input
            type="text"
            placeholder="Search jobs (supports regex)..."
            className="w-full pl-12 pr-4 py-3 bg-white/50 border border-gcs-outline/30 rounded-lg font-data focus:outline-none focus:ring-2 focus:ring-gcs-primary/20 focus:border-gcs-primary transition-all text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex items-center flex-1 md:w-44">
            <span className="material-symbols-outlined absolute left-3 text-gcs-muted text-xl pointer-events-none">
              filter_alt
            </span>
            <select
              className="w-full pl-10 pr-8 py-3 bg-white/50 border border-gcs-outline/30 rounded-lg font-data text-sm focus:outline-none focus:ring-2 focus:ring-gcs-primary/20 focus:border-gcs-primary transition-all appearance-none cursor-pointer"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="ready">Ready</option>
              <option value="in progress">In Progress</option>
              <option value="queued">Queued</option>
              <option value="error">Error</option>
            </select>
            <span className="material-symbols-outlined absolute right-3 text-gcs-muted pointer-events-none text-sm">
              keyboard_arrow_down
            </span>
          </div>

          <div className="relative flex items-center flex-1 md:w-44">
            <span className="material-symbols-outlined absolute left-3 text-gcs-muted text-xl pointer-events-none">
              sort
            </span>
            <select
              className="w-full pl-10 pr-8 py-3 bg-white/50 border border-gcs-outline/30 rounded-lg font-data text-sm focus:outline-none focus:ring-2 focus:ring-gcs-primary/20 focus:border-gcs-primary transition-all appearance-none cursor-pointer"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
            <span className="material-symbols-outlined absolute right-3 text-gcs-muted pointer-events-none text-sm">
              keyboard_arrow_down
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel rounded-xl p-20 flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-6xl text-gcs-muted/20 mb-4 animate-spin">
            progress_activity
          </span>
          <h2 className="font-headline text-2xl text-gcs-muted">Loading jobs…</h2>
        </div>
      ) : sortedAndFilteredMaps.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {sortedAndFilteredMaps.map((map) => (
            <MapCard key={map.id} {...map} />
          ))}
        </div>
      ) : (
        <div className="glass-panel rounded-xl p-20 flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-6xl text-gcs-muted/20 mb-4">
            search_off
          </span>
          <h2 className="font-headline text-2xl text-gcs-muted">No matching jobs found</h2>
          <p className="font-data text-gcs-muted/60">Try adjusting your search or filter parameters</p>
        </div>
      )}
    </div>
  );
}
