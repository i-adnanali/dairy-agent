import { allAnimals, allFeed, allVendors } from '../db';

export interface Catalog {
  animalCount: number;
  groups: { name: string; count: number }[];
  animalLines: string[];
  feedTypes: string[];
}

export interface VendorCatalog {
  vendorCount: number;
  vendorLines: string[];
}

/** Build a compact, current snapshot of the farm for the system prompt. */
export function buildCatalog(): Catalog {
  const animals = allAnimals();
  const feed = allFeed();

  const groupMap = new Map<string, number>();
  for (const a of animals) {
    const g = a.group_name ?? '(no group)';
    groupMap.set(g, (groupMap.get(g) ?? 0) + 1);
  }

  const groups = [...groupMap.entries()].map(([name, count]) => ({ name, count }));

  const animalLines = animals.map(
    (a) => `${a.id} | ${a.tag} — ${a.species} — ${a.status} — ${a.group_name ?? '-'}`,
  );

  return {
    animalCount: animals.length,
    groups,
    animalLines,
    feedTypes: feed.map((f) => f.feed_type),
  };
}

/** Build a compact, current snapshot of the vendors for the vendor agent's
 * system prompt (mirrors buildCatalog for the dairy side). */
export function buildVendorCatalog(): VendorCatalog {
  const vendors = allVendors();
  const vendorLines = vendors.map(
    (v) => `${v.id} | ${v.name} — ${v.status} — ${v.price_per_litre}/L`,
  );
  return { vendorCount: vendors.length, vendorLines };
}
