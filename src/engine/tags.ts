import fs from "fs";
import path from "path";

export type TagItem = {
  id: number;
  name: string;
  category?: string;
};

export type LicenseEntry = {
  label: string;
  aliases: string[];
};

const ROOT_DIR = process.cwd();

const toFullWidth = (s: string): string =>
  s.replace(/\(/g, "（").replace(/\)/g, "）").replace(/~/g, "～");

const toHalfWidth = (s: string): string =>
  s.replace(/（/g, "(").replace(/）/g, ")").replace(/～/g, "~");

const scrub = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[ \t\r\n\u3000、。・／\\＿\-–—~～!?！？。、，．・]/g, "");

const normalize = (s: string): string => scrub(toHalfWidth(toFullWidth(String(s || ""))));

function readJson(filePath: string): any {
  const abs = path.resolve(ROOT_DIR, filePath);
  const raw = fs.readFileSync(abs, "utf-8");
  return JSON.parse(raw);
}

let qualifications: TagItem[] = [];
let tags: TagItem[] = [];
let licenses: LicenseEntry[] = [];

const licenseAliasMap = new Map<string, Set<string>>();
const licenseIdByName = new Map<string, number>();
const licenseNameById = new Map<number, string>();

const tagIdByKey = new Map<string, number>();
const tagNameById = new Map<number, string>();
const normalizedTagKeys: Array<{ id: number; norm: string }> = [];

function initQualifications() {
  if (qualifications.length) return;
  const data = readJson("qualifications.json");
  const arr: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.qualifications)
      ? data.qualifications
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.tags)
          ? data.tags
          : [];

  qualifications = arr
    .map((item) => ({ id: Number(item?.id ?? item?.tag_id ?? item?.value), name: String(item?.name ?? item?.label ?? "") }))
    .filter((item) => Number.isFinite(item.id) && item.name);

  for (const entry of qualifications) {
    licenseNameById.set(entry.id, entry.name);
    const variants = new Set<string>([
      entry.name,
      toFullWidth(entry.name),
      toHalfWidth(entry.name),
      normalize(entry.name),
    ]);
    for (const key of variants) {
      if (!key) continue;
      licenseIdByName.set(key, entry.id);
    }
  }
}

function initLicenses() {
  if (licenses.length) return;
  const data = readJson("licenses.json");
  const entries: LicenseEntry[] = [];
  for (const [, rawList] of Object.entries<any>(data || {})) {
    if (!Array.isArray(rawList)) continue;
    for (const item of rawList) {
      if (!item) continue;
      const label = typeof item === "string" ? item : String(item?.label || "");
      if (!label) continue;
      const aliases = Array.isArray(item?.aliases) ? item.aliases.map((a: any) => String(a || "")).filter(Boolean) : [];
      entries.push({ label, aliases });
    }
  }
  licenses = entries;

  const register = (alias: string, label: string) => {
    if (!alias || !label) return;
    const existing = licenseAliasMap.get(alias) ?? new Set<string>();
    existing.add(label);
    licenseAliasMap.set(alias, existing);
  };

  for (const entry of licenses) {
    const { label, aliases } = entry;
    const variants = new Set<string>([label, toFullWidth(label), toHalfWidth(label)]);
    variants.add(normalize(label));
    for (const variant of variants) register(variant, label);
    register(label, label);
    for (const alias of aliases) {
      const aliasVariants = new Set<string>([alias, toFullWidth(alias), toHalfWidth(alias)]);
      aliasVariants.add(normalize(alias));
      for (const variant of aliasVariants) register(variant, label);
    }
  }
}

function initTags() {
  if (tags.length) return;
  const data = readJson("tags.json");
  const arr: any[] = Array.isArray(data?.tags) ? data.tags : [];
  tags = arr
    .map((item) => ({ id: Number(item?.id), name: String(item?.name || ""), category: item?.category }))
    .filter((item) => Number.isFinite(item.id) && item.name);

  for (const tag of tags) {
    tagNameById.set(tag.id, tag.name);
    const variants = new Set<string>([
      tag.name,
      toFullWidth(tag.name),
      toHalfWidth(tag.name),
      normalize(tag.name),
    ]);
    for (const key of variants) {
      if (!key) continue;
      if (!tagIdByKey.has(key)) tagIdByKey.set(key, tag.id);
    }
    normalizedTagKeys.push({ id: tag.id, norm: normalize(tag.name) });
  }
}

function ensureInitialized() {
  initQualifications();
  initLicenses();
  initTags();
}

function resolveLicenseIdsByLabel(label: string): number[] {
  ensureInitialized();
  const variants = [label, toFullWidth(label), toHalfWidth(label), normalize(label)];
  const out = new Set<number>();
  for (const key of variants) {
    const id = licenseIdByName.get(key);
    if (id != null) out.add(id);
  }
  return Array.from(out);
}

export function matchLicenseLabels(text: string): string[] {
  ensureInitialized();
  const normText = normalize(String(text || ""));
  if (!normText) return [];
  const out = new Set<string>();
  for (const [alias, labels] of licenseAliasMap.entries()) {
    if (!alias || !labels?.size) continue;
    const normAlias = normalize(alias);
    if (!normAlias) continue;
    if (normText.includes(normAlias)) {
      for (const label of labels) {
        if (label) out.add(label);
      }
    }
  }
  return Array.from(out);
}

export function extractQualificationIdsFromText(text: string): number[] {
  ensureInitialized();
  const out = new Set<number>();
  const labels = matchLicenseLabels(text);
  for (const label of labels) {
    for (const id of resolveLicenseIdsByLabel(label)) {
      out.add(id);
    }
  }
  if (!out.size) {
    for (const id of resolveLicenseIdsByLabel(String(text || ""))) {
      out.add(id);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

function resolveTagIdByLabel(label: string): number | undefined {
  ensureInitialized();
  const candidates = [label, toFullWidth(label), toHalfWidth(label), normalize(label)];
  for (const key of candidates) {
    const id = tagIdByKey.get(key);
    if (id != null) return id;
  }
  return undefined;
}

export function matchTagIds(text: string): number[] {
  ensureInitialized();
  const raw = String(text || "").trim();
  if (!raw) return [];
  const out = new Set<number>();
  const directCandidates = [raw, toFullWidth(raw), toHalfWidth(raw), normalize(raw)];
  for (const key of directCandidates) {
    const id = tagIdByKey.get(key);
    if (id != null) out.add(id);
  }
  const normText = normalize(raw);
  if (normText) {
    for (const entry of normalizedTagKeys) {
      if (!entry.norm) continue;
      if (normText.includes(entry.norm) || entry.norm.includes(normText)) {
        out.add(entry.id);
      }
    }
  }
  return Array.from(out);
}

export function quickKeywordsToLabels(text: string): string[] {
  const t = String(text || "").toLowerCase();
  const out = new Set<string>();
  if (/(ﾎﾞｰﾅｽ|ボーナス|bonus)/.test(t)) out.add("賞与");
  if (/(有給|有休)/.test(t)) out.add("有給消化率ほぼ100%");
  if (/残業|定時|ｻﾋﾞ残|サビ残/.test(t)) {
    out.add("残業0");
    out.add("残業月20時間以内");
  }
  return Array.from(out);
}

export function mapLabelsToTagIds(labels: string[]): number[] {
  ensureInitialized();
  const out = new Set<number>();
  for (const label of labels) {
    const id = resolveTagIdByLabel(label);
    if (id != null) out.add(id);
  }
  return Array.from(out);
}

export function findMustHaveTagIds(text: string): number[] {
  ensureInitialized();
  const out = new Set<number>();
  for (const id of matchTagIds(text)) out.add(id);
  const labels = quickKeywordsToLabels(text);
  for (const id of mapLabelsToTagIds(labels)) out.add(id);
  return Array.from(out).sort((a, b) => a - b);
}

export function getTagNameById(id: number): string | undefined {
  ensureInitialized();
  return tagNameById.get(id);
}
