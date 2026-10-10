import L from 'leaflet';

const LOCATION_MARKER_ICON = L.divIcon({
  className: '',
  iconSize: [32, 40],
  iconAnchor: [16, 40],
  popupAnchor: [0, -36],
  html: `<div class="relative flex flex-col items-center">
    <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 6px 4px rgba(0,0,0,0.4));">
      <defs>
        <linearGradient id="jp-location-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#4B7C63" />
          <stop offset="100%" stop-color="#2a4a39" />
        </linearGradient>
        <radialGradient id="jp-location-highlight" cx="35%" cy="30%" r="45%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <path d="M16,0 C7.163,0 0,7.163 0,16 C0,24 16,40 16,40 C16,40 32,24 32,16 C32,7.163 24.837,0 16,0 Z" fill="url(#jp-location-grad)" />
      <path d="M16,0 C7.163,0 0,7.163 0,16 C0,24 16,40 16,40 C16,40 32,24 32,16 C32,7.163 24.837,0 16,0 Z" fill="url(#jp-location-highlight)" />
      <circle cx="16" cy="14" r="6" fill="#ffffff" />
    </svg>
    <div class="absolute -bottom-1.5 w-5 h-2 bg-black/30 blur-[2px] rounded-[100%] scale-y-50"></div>
  </div>`,
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function loadingContent() {
  return `<div class="p-5 font-sans min-w-[320px] flex flex-col items-center justify-center min-h-[130px] gap-3 bg-white rounded-2xl">
    <div class="jp-location-spinner"></div>
    <span class="text-[12px] font-medium text-gray-500">Loading...</span>
  </div>`;
}

function popupContent({ address, lat, lng, title, detectedAt }) {
  return `<div class="px-5 pt-5 pb-1 font-sans min-w-[320px] relative bg-white rounded-2xl">
    <button type="button" class="jp-location-close absolute right-5 top-5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700" aria-label="Tutup popup">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    ${title ? `<div class="mb-4 pr-6">
      <div class="flex items-center gap-1 text-[#4B7C63] font-extrabold uppercase tracking-[0.14em] text-[9px]">
        Lahan
      </div>
      <p class="text-[16px] font-black text-gray-950 leading-tight m-0" style="margin-top:4px">${escapeHtml(title)}</p>
    </div>
    <div class="h-[1px] w-full bg-gray-200 mb-3"></div>` : ''}
    ${detectedAt ? `<div class="mb-4 pr-6">
      <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
        Capture at
      </div>
      <p class="text-[12px] font-bold text-gray-900 leading-[1.4] m-0" style="margin-top:3px">${escapeHtml(detectedAt)}</p>
    </div>
    <div class="h-[1px] w-full bg-gray-200 mb-3"></div>` : ''}
    <div class="mb-4 pr-6">
      <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        Lokasi
      </div>
      <p class="text-[12px] font-bold text-gray-900 leading-[1.4] m-0" style="margin-top:3px">${escapeHtml(address)}</p>
    </div>
    <div class="h-[1px] w-full bg-gray-200 mb-3"></div>
    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col">
        <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
          <div class="w-3 h-3 rounded-full border-[1.5px] border-current flex items-center justify-center">
            <div class="w-2 h-[1.5px] bg-current"></div>
          </div>
          LAT
        </div>
        <p class="font-extrabold text-gray-900 text-[12px] leading-tight m-0" style="margin-top:1px">${lat.toFixed(6)}</p>
      </div>
      <div class="flex flex-col">
        <div class="flex items-center gap-1 text-[#4B7C63] font-bold uppercase tracking-widest text-[9px]">
          <div class="w-3 h-3 rounded-full border-[1.5px] border-current flex items-center justify-center">
            <div class="w-2 h-[1.5px] bg-current rotate-90"></div>
          </div>
          LONG
        </div>
        <p class="font-extrabold text-gray-900 text-[12px] leading-tight m-0" style="margin-top:1px">${lng.toFixed(6)}</p>
      </div>
    </div>
  </div>`;
}

function attachCloseHandler(marker, onClose) {
  const popup = marker.getPopup();
  const element = popup?.getElement();
  const button = element?.querySelector('.jp-location-close');
  if (!button) return;
  button.onclick = (event) => {
    event.stopPropagation();
    onClose?.();
  };
}

export function createLocationMarker({ lat, lng, onClose, title, detectedAt, address }) {
  const marker = L.marker([lat, lng], { icon: LOCATION_MARKER_ICON });
  marker.bindPopup(loadingContent(), {
    closeButton: false,
    className: 'jp-location-popup',
    minWidth: 320,
    maxWidth: 360,
  });

  marker.on('popupopen', () => attachCloseHandler(marker, onClose));
  marker.on('popupclose', () => onClose?.());

  if (address) {
    marker.getPopup()?.setContent(popupContent({ address, lat, lng, title, detectedAt }));
    return marker;
  }

  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
    .then((res) => res.json())
    .then((data) => {
      const address = data?.display_name || 'Tidak ada data lokasi di titik ini.';
      marker.getPopup()?.setContent(popupContent({ address, lat, lng, title, detectedAt }));
      requestAnimationFrame(() => {
        marker.getPopup()?.update();
        attachCloseHandler(marker, onClose);
      });
    })
    .catch(() => {
      marker.getPopup()?.setContent(popupContent({ address: 'Gagal memuat alamat.', lat, lng, title, detectedAt }));
      requestAnimationFrame(() => {
        marker.getPopup()?.update();
        attachCloseHandler(marker, onClose);
      });
    });

  return marker;
}
