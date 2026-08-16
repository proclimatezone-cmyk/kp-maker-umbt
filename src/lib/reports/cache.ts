import { fetchReportSheets } from './sheet-source';
import { computeSalesReport, type SalesReport } from './sales';
import { computeBookingsReport, type BookingsReport } from './bookings';
import { computePriceComparison, type PriceComparisonReport } from './price-comparison';
import { getProducts } from '@/lib/products-cache';

// Данные склада/цен не меняются поминутно — 10 минут, как у products-cache.ts,
// чтобы открытие каждой вкладки дашборда не било по Google Sheets API.
const CACHE_TTL = 10 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

let salesCache: CacheEntry<SalesReport> | null = null;
let bookingsCache: CacheEntry<BookingsReport> | null = null;
let priceCache: CacheEntry<PriceComparisonReport> | null = null;

function isFresh<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL;
}

async function loadSheetReports() {
  const { orders, bookings, objects } = await fetchReportSheets();
  salesCache = { data: computeSalesReport(orders, objects), fetchedAt: Date.now() };
  bookingsCache = { data: computeBookingsReport(bookings), fetchedAt: Date.now() };
}

export async function getSalesReport(): Promise<SalesReport> {
  if (!isFresh(salesCache)) await loadSheetReports();
  return salesCache!.data;
}

export async function getBookingsReport(): Promise<BookingsReport> {
  if (!isFresh(bookingsCache)) await loadSheetReports();
  return bookingsCache!.data;
}

export async function getPriceComparisonReport(): Promise<PriceComparisonReport> {
  if (isFresh(priceCache)) return priceCache!.data;
  const products = await getProducts();
  const data = computePriceComparison(
    (products as any[]).map((p) => ({ model: p.model, category: p.category, price: Number(p.price) || 0 }))
  );
  priceCache = { data, fetchedAt: Date.now() };
  return data;
}
