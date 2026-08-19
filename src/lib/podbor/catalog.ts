import productsData from '@/data/products.json';

/**
 * Классификация каталога для раздела «Подбор» — три реальных семейства
 * оборудования из products.json: VRF-система (внутренние блоки V8 /
 * ATOM B), Фанкойл (2-х / 4-х трубный) и Высоконапорный канальный сплит.
 * Строится один раз из категорий прайса регэкспами, а не хардкодом
 * названий — устойчиво к пробелам/опечаткам в исходнике («Высококонапорная»).
 */

export type Family = 'vrf' | 'fancoil' | 'split';
export type FormFactor = 'cassette' | 'wall' | 'duct' | 'floor_ceiling';
export type Series = 'v8' | 'atom_b';
export type PipeType = '2p' | '4p';

export interface PodborProduct {
  id: string;
  model: string;
  price: number;
  coolingCapacity: number;
  category: string;
  image?: string;
  family: Family;
  formFactor: FormFactor | null;
  series: Series | null;
  pipeType: PipeType | null;
}

export const FAMILY_LABEL: Record<Family, string> = {
  vrf: 'VRF-система',
  fancoil: 'Фанкойл',
  split: 'Высоконапорный канальный сплит',
};

export const FORM_FACTOR_LABEL: Record<FormFactor, string> = {
  cassette: 'Кассетный',
  wall: 'Настенный',
  duct: 'Канальный',
  floor_ceiling: 'Напольно-потолочный',
};

export const SERIES_LABEL: Record<Series, string> = { v8: 'V8', atom_b: 'ATOM B' };
export const PIPE_LABEL: Record<PipeType, string> = { '2p': '2-х трубный', '4p': '4-х трубный' };

function base(p: any) {
  return {
    id: p.id as string,
    model: p.model as string,
    price: Number(p.price) || 0,
    coolingCapacity: Number(p.coolingCapacity) || 0,
    category: (p.category || '').trim(),
    image: p.image as string | undefined,
  };
}

function classify(p: any): PodborProduct | null {
  const cat = (p.category || '').trim();
  if (!cat) return null;

  // Внутренние блоки VRF/mini-VRF — наружные блоки на комнату не подбираются.
  if (/VRF|mini-VRF/i.test(cat) && !/^Наружный/i.test(cat) && !/Компрессорно-конденсаторный/i.test(cat)) {
    let formFactor: FormFactor | null = null;
    if (/кассетн/i.test(cat)) formFactor = 'cassette';
    else if (/настенн/i.test(cat)) formFactor = 'wall';
    else if (/канальн/i.test(cat)) formFactor = 'duct';
    if (!formFactor) return null;
    const series: Series | null = /серии V8/i.test(cat) ? 'v8' : /серии ATOM B/i.test(cat) ? 'atom_b' : null;
    if (!series) return null;
    return { ...base(p), family: 'vrf', formFactor, series, pipeType: null };
  }

  if (/^Фанкойл/i.test(cat)) {
    let formFactor: FormFactor | null = null;
    if (/кассетн/i.test(cat)) formFactor = 'cassette';
    else if (/канальн/i.test(cat)) formFactor = 'duct';
    else if (/напольно-потолочн/i.test(cat)) formFactor = 'floor_ceiling';
    if (!formFactor) return null;
    const pipeType: PipeType | null = /4-?х\s?трубн/i.test(cat) ? '4p' : /2-?х\s?трубн/i.test(cat) ? '2p' : null;
    return { ...base(p), family: 'fancoil', formFactor, series: null, pipeType };
  }

  if (/Высококонапорная канальная сплит/i.test(cat)) {
    return { ...base(p), family: 'split', formFactor: null, series: null, pipeType: null };
  }

  return null;
}

export const PODBOR_CATALOG: PodborProduct[] = (productsData as any[])
  .map(classify)
  .filter((x): x is PodborProduct => x !== null);

export function familyProducts(family: Family): PodborProduct[] {
  return PODBOR_CATALOG.filter(p => p.family === family);
}

const FORM_FACTOR_ORDER: FormFactor[] = ['cassette', 'wall', 'duct', 'floor_ceiling'];

export function formFactorOptions(family: Family): FormFactor[] {
  const set = new Set<FormFactor>();
  familyProducts(family).forEach(p => p.formFactor && set.add(p.formFactor));
  return FORM_FACTOR_ORDER.filter(f => set.has(f));
}

export function seriesOptions(family: Family, formFactor: FormFactor | null): Series[] {
  const set = new Set<Series>();
  familyProducts(family).filter(p => p.formFactor === formFactor).forEach(p => p.series && set.add(p.series));
  return (['v8', 'atom_b'] as Series[]).filter(s => set.has(s));
}

export function pipeTypeOptions(family: Family, formFactor: FormFactor | null): PipeType[] {
  const set = new Set<PipeType>();
  familyProducts(family).filter(p => p.formFactor === formFactor).forEach(p => p.pipeType && set.add(p.pipeType));
  return (['2p', '4p'] as PipeType[]).filter(t => set.has(t));
}

/** Кандидаты для авто-подбора по выбранной ветке (семейство → форм-фактор → серия/трубность). */
export function candidatesFor(
  family: Family,
  formFactor: FormFactor | null,
  seriesOrPipe: Series | PipeType | null
): PodborProduct[] {
  return familyProducts(family)
    .filter(p => (formFactor ? p.formFactor === formFactor : true))
    .filter(p => {
      if (family === 'vrf') return seriesOrPipe ? p.series === seriesOrPipe : true;
      if (family === 'fancoil') return seriesOrPipe ? p.pipeType === seriesOrPipe : true;
      return true;
    })
    .sort((a, b) => a.coolingCapacity - b.coolingCapacity);
}

export interface MatchResult {
  product: PodborProduct | null;
  reason: 'ok' | 'no_capacity_data' | 'no_candidates';
}

/**
 * Авто-подбор: наименьшая модель, которой хватает по мощности; если ни
 * одной не хватает — берём старшую в линейке (лучше показать «не хватает»,
 * чем тихо занизить). Категории без coolingCapacity в каталоге (пробел в
 * products.json, напр. «Высоконапорный сплит») подбирать нечем — это явно
 * помечается, чтобы вести к ручному выбору, а не подставлять случайную модель.
 */
export function matchByPower(candidates: PodborProduct[], requiredKw: number): MatchResult {
  if (candidates.length === 0) return { product: null, reason: 'no_candidates' };
  const withCapacity = candidates.filter(p => p.coolingCapacity > 0);
  if (withCapacity.length === 0) return { product: null, reason: 'no_capacity_data' };
  const fit = withCapacity.find(p => p.coolingCapacity >= requiredKw);
  return { product: fit || withCapacity[withCapacity.length - 1], reason: 'ok' };
}

export function productLabel(p: PodborProduct): string {
  const kw = p.coolingCapacity > 0 ? `${String(p.coolingCapacity).replace('.', ',')} кВт · ` : '';
  return `${p.model} · ${kw}${p.price} у.е.`;
}
