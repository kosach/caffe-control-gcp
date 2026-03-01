import { syncCatalog } from './index';

// Mock dependencies
jest.mock('../../utils/mongodb');
jest.mock('@google-cloud/bigquery');

import { getSecret } from '../../utils/mongodb';
import { BigQuery } from '@google-cloud/bigquery';

const mockFetch = jest.fn();
global.fetch = mockFetch;

type MockRequest = {
  method?: string;
  query?: Record<string, any>;
};

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

function createMockResponse(): MockResponse {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json };
}

describe('syncCatalog', () => {
  let mockInsert: jest.Mock;
  let mockQuery: jest.Mock;
  let mockTable: jest.Mock;
  let mockDataset: jest.Mock;

  const mockProducts = [
    {
      product_id: '478',
      product_name: 'Капучино (300 мл) MK',
      menu_category_id: '1',
      category_name: 'Основне меню',
      type: '2',
      unit: '',
      cost: '2759',
      cost_netto: '2299',
      hidden: '0',
      out: '0',
      sort_order: '1',
    },
  ];

  const mockCategories = [
    {
      category_id: '1',
      category_name: 'Основне меню',
      parent_category: '0',
      category_hidden: '0',
      sort_order: '1',
      level: '1',
      visible: [],
    },
    {
      category_id: '10',
      category_name: 'Кава',
      parent_category: '1',
      category_hidden: '0',
      sort_order: '2',
      level: '2',
      visible: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    (getSecret as jest.Mock)
      .mockResolvedValueOnce('valid-token')  // api-auth-key
      .mockResolvedValueOnce('poster-token'); // poster-token

    mockInsert = jest.fn().mockResolvedValue([]);
    mockQuery = jest.fn().mockResolvedValue([[]]);
    mockTable = jest.fn().mockReturnValue({ insert: mockInsert });
    mockDataset = jest.fn().mockReturnValue({ table: mockTable });

    (BigQuery as unknown as jest.Mock).mockImplementation(() => ({
      dataset: mockDataset,
      query: mockQuery,
    }));

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: mockProducts }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: mockCategories }),
      });
  });

  test('returns 401 when auth token is missing', async () => {
    const req = { query: {} } as any;
    const res = createMockResponse();

    await syncCatalog(req, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 401 when auth token is invalid', async () => {
    const req = { query: { 'auth-token': 'wrong' } } as any;
    const res = createMockResponse();

    await syncCatalog(req, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('syncs products and categories to BigQuery', async () => {
    const req = { query: { 'auth-token': 'valid-token' } } as any;
    const res = createMockResponse();

    await syncCatalog(req, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    const result = res.json.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.data.products).toBe(1);
    expect(result.data.categories).toBe(2);

    // Verify BQ delete was called for both tables
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Verify insert was called for both tables
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  test('resolves root_category correctly', async () => {
    const req = { query: { 'auth-token': 'valid-token' } } as any;
    const res = createMockResponse();

    await syncCatalog(req, res as any);

    // Products insert call — first insert after products DELETE
    const productRows = mockInsert.mock.calls[0][0];
    expect(productRows[0].root_category).toBe('Основне меню');

    // Categories insert — second insert
    const categoryRows = mockInsert.mock.calls[1][0];
    const subcategory = categoryRows.find((c: any) => c.category_id === '10');
    expect(subcategory.root_category).toBe('Основне меню');
    expect(subcategory.parent_category_name).toBe('Основне меню');
  });

  test('converts cost from kopecks to UAH', async () => {
    const req = { query: { 'auth-token': 'valid-token' } } as any;
    const res = createMockResponse();

    await syncCatalog(req, res as any);

    const productRows = mockInsert.mock.calls[0][0];
    expect(productRows[0].cost).toBe(27.59); // 2759 / 100
  });

  test('handles Poster API error', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    // Need fresh mocks for getSecret
    (getSecret as jest.Mock).mockReset();
    (getSecret as jest.Mock)
      .mockResolvedValueOnce('valid-token')
      .mockResolvedValueOnce('poster-token');

    const req = { query: { 'auth-token': 'valid-token' } } as any;
    const res = createMockResponse();

    await syncCatalog(req, res as any);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
