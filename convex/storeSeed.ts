/**
 * Initial contents of the `stores` table. Run `npx convex run stores:seed` to
 * insert these (existing stores are updated, nothing is deleted). After that the
 * table is the source of truth: edit it in the Convex dashboard or with
 * `npx convex run stores:upsert '{"name":"...","aliases":["..."]}'`.
 *
 * Each entry is `[display name, aliases]`. Aliases are matched against the
 * receipt text case- and accent-insensitively, with some tolerance for OCR
 * typos, so write them the way they are printed on the receipt. Prefer
 * distinctive, multi-word aliases: a single common word (e.g. "easy") can match
 * unrelated text.
 *
 * When several stores match, the one printed highest on the receipt wins (e.g.
 * a receipt headed "Abarrotes Económicos" that later says "por cta. de Walmart
 * Chile" is Abarrotes Económicos).
 */
export const STORE_SEED: [name: string, aliases: string[]][] = [
  // Samples
  ["Supermercado La Magia de la Economía", ["la magia de la economia"]],
  ["Farmacias Ahumada", ["farmacias ahumada", "farmacia ahumada"]],
  ["Abarrotes Económicos", ["abarrotes economicos"]],
  ["Barnes & Noble Booksellers", ["barnes & noble booksellers"]],
  // Supermarkets
  ["Lider", ["hiper lider", "express de lider", "supermercado lider", "lider express"]],
  ["Walmart Chile", ["walmart chile"]],
  ["Jumbo", ["jumbo"]],
  ["Santa Isabel", ["santa isabel"]],
  ["Unimarc", ["unimarc"]],
  ["Tottus", ["tottus"]],
  ["Acuenta", ["acuenta"]],
  ["Mayorista 10", ["mayorista 10"]],
  ["Alvi", ["supermercado alvi", "alvi supermercados"]],
  ["OK Market", ["ok market"]],
  // Local markets
  ["Prolog F y V Limitada", ["prolog f y v limitada"]],
  // Pharmacies
  ["Cruz Verde", ["cruz verde"]],
  ["Salcobrand", ["salcobrand"]],
  ["Dr. Simi", ["farmacias similares", "dr simi"]],
  // Home improvement / department stores
  ["Sodimac", ["sodimac", "homecenter"]],
  ["Easy", ["easy retail", "tiendas easy"]],
  ["Construmart", ["construmart"]],
  ["Falabella", ["falabella"]],
  ["Ripley", ["ripley"]],
  ["Paris", ["tiendas paris"]],
  // Fuel / convenience
  ["Copec", ["copec"]],
  ["Shell", ["enex", "shell"]],
  ["Petrobras", ["petrobras", "aramco"]],
];
