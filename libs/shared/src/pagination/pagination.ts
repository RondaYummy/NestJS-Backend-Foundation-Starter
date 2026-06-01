export interface PaginationInput {
  page: number;
  limit: number;
}
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export const getOffset = ({ page, limit }: PaginationInput): number =>
  (Math.max(page, 1) - 1) * limit;
