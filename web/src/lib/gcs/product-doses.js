// Reference product catalogue (from ref_dose.jpeg) used to pick what chemical is
// loaded into each spray chamber and, from that, the default application rate.
//
// The pump meters LIQUID VOLUME (L/min), so the number that actually drives the
// spray rate is the reference "Volume Akhir per m²" (final spray volume per m²),
// NOT the "Dosis Produk per m²" (concentrate to mix into the tank — informational
// only). rateLpha = volumePerM2L × 10_000 (1 L/m² = 10_000 L/ha).
//
// Any product may be loaded into either chamber — the chamber name is just the
// physical tank label. Keep this list in sync with the backend mirror in
// server/app/routes/fields.py (PRODUCT_DOSES).

/** @typedef {{ id: string, no: number, category: string, activeIngredient: string,
 *   name: string, form: string, doseProduct: string, volumePerM2L: number,
 *   rateLpha: number, concentration: string }} Product */

/** @type {Product[]} */
export const PRODUCTS = [
  { id: "kontaf-50-sc",       no: 1, category: "Jamur",  activeIngredient: "Heksakonazol",  name: "Kontaf 50 SC",       form: "Cair",   doseProduct: "0,015 ml",     volumePerM2L: 0.015, rateLpha: 150, concentration: "1 ml/L" },
  { id: "benlox-50-wp",       no: 2, category: "Jamur",  activeIngredient: "Benomil",       name: "Benlox 50 WP",       form: "Serbuk", doseProduct: "0,05 g",       volumePerM2L: 0.050, rateLpha: 500, concentration: "1 g/L" },
  { id: "dithane-m-45",       no: 3, category: "Jamur",  activeIngredient: "Mankozeb",      name: "Dithane M-45",       form: "Serbuk", doseProduct: "0,05 g",       volumePerM2L: 0.050, rateLpha: 500, concentration: "1 g/L" },
  { id: "cabzim-500-sc",      no: 4, category: "Jamur",  activeIngredient: "Karbendazim",   name: "Cabzim 500 SC",      form: "Cair",   doseProduct: "0,05 ml",      volumePerM2L: 0.050, rateLpha: 500, concentration: "1 ml/L" },
  { id: "fenosida-255-ec",    no: 5, category: "Jamur",  activeIngredient: "Difenokonazol", name: "Fenosida 255 EC",    form: "Cair",   doseProduct: "0,05 ml",      volumePerM2L: 0.050, rateLpha: 500, concentration: "1 ml/L" },
  { id: "besun-elite-300-sc", no: 6, category: "Bakteri", activeIngredient: "Zinc thiazole", name: "Besun Elite 300 SC", form: "Cair",   doseProduct: "0,1 ml",       volumePerM2L: 0.050, rateLpha: 500, concentration: "2 ml/L" },
  { id: "starner-20-wp",      no: 7, category: "Bakteri", activeIngredient: "Asam oksolinik", name: "Starner 20 WP",     form: "Serbuk", doseProduct: "0,02–0,05 g",  volumePerM2L: 0.020, rateLpha: 200, concentration: "1–2,5 g/L" },
];

const PRODUCT_BY_ID = new Map(PRODUCTS.map((product) => [product.id, product]));

/** @returns {Product | null} */
export function productById(id) {
  if (!id) return null;
  return PRODUCT_BY_ID.get(String(id)) ?? null;
}

/**
 * Default application rate (L/ha) for a product id, or null when the id is
 * unknown/empty so callers can fall back to their own default.
 */
export function productRateLpha(id) {
  const product = productById(id);
  return product ? product.rateLpha : null;
}
