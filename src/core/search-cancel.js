/** Aktif arama iptal bayragi — POST /api/search/cancel ile set edilir. */

let cancelled = false;
let generation = 0;

export function beginSearch() {
  cancelled = false;
  generation += 1;
  return generation;
}

export function requestCancel() {
  cancelled = true;
  return { cancelled: true, generation };
}

export function isCancelled() {
  return cancelled;
}

export function throwIfCancelled() {
  if (cancelled) {
    const err = new Error("Arama iptal edildi");
    err.code = "SEARCH_CANCELLED";
    throw err;
  }
}

export function endSearch(gen) {
  if (gen === generation) cancelled = false;
}
