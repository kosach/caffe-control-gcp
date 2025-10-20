import { ObjectId } from 'mongodb';
import { webhook } from './index';
import axios from 'axios';

jest.mock('../../utils/mongodb', () => ({
  connectToDatabase: jest.fn(),
  getSecret: jest.fn()
}));

jest.mock('axios');

import { connectToDatabase, getSecret } from '../../utils/mongodb';

type MockRequest = {
  method?: string;
  query?: Record<string, any>;
  body?: any;
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

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('webhook', () => {
  const insertedId = new ObjectId('507f1f77bcf86cd799439011');
  const insertOne = jest.fn();
  const updateRaw = jest.fn();
  const updateTransaction = jest.fn();
  const collection = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    insertOne.mockResolvedValue({ insertedId });
    updateRaw.mockResolvedValue({ acknowledged: true });
    updateTransaction.mockResolvedValue({ acknowledged: true });

    collection.mockImplementation((name: string) => {
      if (name === 'poster-hooks-data') {
        return {
          insertOne,
          updateOne: updateRaw
        };
      }

      if (name === 'transactions') {
        return {
          updateOne: updateTransaction
        };
      }

      throw new Error(`Unexpected collection ${name}`);
    });

    (connectToDatabase as jest.Mock).mockResolvedValue({
      db: { collection }
    });

    (getSecret as jest.Mock).mockImplementation((key: string) => {
      if (key === 'poster-hook-api-key') return Promise.resolve('valid-key');
      if (key === 'poster-token') return Promise.resolve('test-poster-token');
      return Promise.resolve('mock-secret');
    });

    // Mock Poster API response
    mockedAxios.get.mockResolvedValue({
      data: {
        response: {
          transaction_id: '123',
          account_id: '1',
          user_id: '1',
          category_id: '7',
          type: '0',
          amount: '-8137663',
          balance: '545516997964',
          date: '2024-08-31 09:20:22',
          recipient_type: '0',
          recipient_id: '0',
          binding_type: '15',
          binding_id: '400',
          comment: 'Test transaction',
          delete: '0',
          account_name: 'Cash',
          category_name: 'Sales',
          currency_symbol: '$'
        }
      }
    });

    Object.defineProperty(axios, 'isAxiosError', {
      value: jest.fn().mockReturnValue(false),
      writable: true
    });
  });

  function buildRequest(overrides: Partial<MockRequest> = {}): MockRequest {
    return {
      method: 'POST',
      query: { 'api-key': 'valid-key' },
      body: {
        account: 'test_account',
        account_number: '12345',
        object: 'transaction',
        object_id: 123,
        action: 'added',
        time: '1729400000',
        verify: 'test_hash',
        data: '{"status":"2"}'
      },
      ...overrides
    };
  }

  test('returns 405 for non-POST method', async () => {
    const req = buildRequest({ method: 'GET' });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    expect(connectToDatabase).not.toHaveBeenCalled();
  });

  test('returns 401 when api key missing', async () => {
    const req = buildRequest({ query: {} });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(connectToDatabase).not.toHaveBeenCalled();
  });

  test('returns 401 when api key invalid', async () => {
    const req = buildRequest({ query: { 'api-key': 'wrong' } });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(connectToDatabase).not.toHaveBeenCalled();
  });

  test('returns 500 when raw webhook cannot be stored', async () => {
    insertOne.mockRejectedValueOnce(new Error('DB down'));

    const req = buildRequest();
    const res = createMockResponse();

  await webhook(req as any, res as any);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({
    error: 'Processing failed',
    message: 'Unexpected error'
  });
});

  test('returns 400 for invalid JSON payload', async () => {
    const req = buildRequest({ body: '{invalid json}', query: { 'api-key': 'valid-key' } });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(updateRaw).toHaveBeenCalledWith(
      { _id: insertedId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.processing_error': 'Invalid JSON payload'
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: 'Invalid JSON payload'
    });
  });

  test('returns 400 when action missing', async () => {
    const req = buildRequest({
      body: {
        data: { transaction_id: 123 }
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(updateRaw).toHaveBeenCalledWith(
      { _id: insertedId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.processing_error': 'Missing required field: action'
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: 'Missing required field: action'
    });
  });

  test('returns 400 when action invalid', async () => {
    const req = buildRequest({
      body: {
        action: 'deleted',
        data: { transaction_id: 123 }
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(updateRaw).toHaveBeenCalledWith(
      { _id: insertedId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.processing_error': expect.stringContaining('Invalid action: deleted')
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: expect.stringContaining('Invalid action: deleted')
    });
  });

  test('returns 400 when object_id missing', async () => {
    const req = buildRequest({
      body: {
        action: 'added',
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(updateRaw).toHaveBeenCalledWith(
      { _id: insertedId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.processing_error': 'Missing required field: object_id'
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: 'Missing required field: object_id'
    });
  });

  test('skips saving to transactions for added action', async () => {
    const req = buildRequest({
      body: {
        action: 'added',
        object_id: 789,
        data: '{"status":"1"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should NOT save to transactions for 'added' action
    expect(updateTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 789,
      action: 'added',
      saved_to_transactions: false,
      raw_hook_id: insertedId.toHexString()
    });
  });

  test('stores raw webhook and skips transactions for added action', async () => {
    const req = buildRequest(); // Default action is 'added'
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(insertOne).toHaveBeenCalled();
    expect(updateTransaction).not.toHaveBeenCalled();
    expect(updateRaw).toHaveBeenCalledWith(
      { _id: insertedId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.processed': true,
          'metadata.saved_to_transactions': false
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 123,
      action: 'added',
      saved_to_transactions: false,
      raw_hook_id: insertedId.toHexString()
    });
  });

  test('upserts transaction when action is changed', async () => {
    const req = buildRequest({
      body: {
        object_id: 999,
        action: 'changed',
        data: '{"status":"2","payed_sum":"7500"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    // Should call Poster API
    expect(mockedAxios.get).toHaveBeenCalled();

    // Should save ONLY Poster API data (no webhook metadata)
    // Query uses Poster API's transaction_id (string) from response
    expect(updateTransaction).toHaveBeenCalledWith(
      { transaction_id: '123' },  // String from Poster API response
      {
        $set: {
          transaction_id: '123',
          account_id: '1',
          user_id: '1',
          category_id: '7',
          type: '0',
          amount: '-8137663',
          balance: '545516997964',
          date: '2024-08-31 09:20:22',
          recipient_type: '0',
          recipient_id: '0',
          binding_type: '15',
          binding_id: '400',
          comment: 'Test transaction',
          delete: '0',
          account_name: 'Cash',
          category_name: 'Sales',
          currency_symbol: '$'
        }
      },
      { upsert: true }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      object_id: 999,
      action: 'changed',
      saved_to_transactions: true,
      raw_hook_id: insertedId.toHexString()
    });
  });

  test('returns 500 when transaction upsert fails', async () => {
    updateTransaction.mockRejectedValueOnce(new Error('Write error'));

    const req = buildRequest({
      body: {
        action: 'changed',
        object_id: 42,
        data: '{"status":"2"}'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(updateRaw).toHaveBeenCalledWith(
      { _id: insertedId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.processing_error': 'Write error'
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Processing failed',
      message: 'Unexpected error'
    });
  });

  describe('Real Poster webhook format', () => {
    test('handles real Poster format with changed action', async () => {
      const req = buildRequest({
        body: {
          account: 'mykava6',
          object: 'transaction',
          object_id: 16776,
          action: 'changed',
          time: '1688722229',
          verify: 'f6a209fccb87d7051d49bf3342c656ab',
          account_number: '333226',
          data: '{"status":"2","payed_sum":"5000"}'
        }
      });
      const res = createMockResponse();

      await webhook(req as any, res as any);

      // Should fetch data from Poster API
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('https://joinposter.com/api/finance.getTransaction'),
        expect.objectContaining({ timeout: 10000 })
      );

      // Should save ONLY Poster API data (no webhook metadata)
      // Query uses Poster API's transaction_id (string) from response
      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: '123' },  // String from Poster API response
        {
          $set: {
            transaction_id: '123',
            account_id: '1',
            user_id: '1',
            category_id: '7',
            type: '0',
            amount: '-8137663',
            balance: '545516997964',
            date: '2024-08-31 09:20:22',
            recipient_type: '0',
            recipient_id: '0',
            binding_type: '15',
            binding_id: '400',
            comment: 'Test transaction',
            delete: '0',
            account_name: 'Cash',
            category_name: 'Sales',
            currency_symbol: '$'
          }
        },
        { upsert: true }
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        object_id: 16776,
        action: 'changed',
        saved_to_transactions: true,
        raw_hook_id: insertedId.toHexString()
      });
    });

    test('handles real Poster format with nested JSON string data', async () => {
      const req = buildRequest({
        body: {
          object_id: 99999,
          action: 'changed',
          data: '{"transactions_history":{"type_history":"additem","time":1688722229115}}'
        }
      });
      const res = createMockResponse();

      await webhook(req as any, res as any);

      // Should save ONLY Poster API data
      // Query uses Poster API's transaction_id (string) from response
      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: '123' },  // String from Poster API response
        {
          $set: {
            transaction_id: '123',
            account_id: '1',
            user_id: '1',
            category_id: '7',
            type: '0',
            amount: '-8137663',
            balance: '545516997964',
            date: '2024-08-31 09:20:22',
            recipient_type: '0',
            recipient_id: '0',
            binding_type: '15',
            binding_id: '400',
            comment: 'Test transaction',
            delete: '0',
            account_name: 'Cash',
            category_name: 'Sales',
            currency_symbol: '$'
          }
        },
        { upsert: true }
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('handles real Poster format with data as object', async () => {
      const req = buildRequest({
        body: {
          object_id: 88888,
          action: 'changed',
          data: {
            status: '2',
            amount: 1500
          }
        }
      });
      const res = createMockResponse();

      await webhook(req as any, res as any);

      // Should save ONLY Poster API data
      // Query uses Poster API's transaction_id (string) from response
      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: '123' },  // String from Poster API response
        {
          $set: {
            transaction_id: '123',
            account_id: '1',
            user_id: '1',
            category_id: '7',
            type: '0',
            amount: '-8137663',
            balance: '545516997964',
            date: '2024-08-31 09:20:22',
            recipient_type: '0',
            recipient_id: '0',
            binding_type: '15',
            binding_id: '400',
            comment: 'Test transaction',
            delete: '0',
            account_name: 'Cash',
            category_name: 'Sales',
            currency_symbol: '$'
          }
        },
        { upsert: true }
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('handles real Poster format with invalid JSON string in data', async () => {
      const req = buildRequest({
        body: {
          object_id: 77777,
          action: 'changed',
          data: '{invalid json}'
        }
      });
      const res = createMockResponse();

      await webhook(req as any, res as any);

      // Should save ONLY Poster API data (ignoring invalid webhook data)
      // Query uses Poster API's transaction_id (string) from response
      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: '123' },  // String from Poster API response
        {
          $set: {
            transaction_id: '123',
            account_id: '1',
            user_id: '1',
            category_id: '7',
            type: '0',
            amount: '-8137663',
            balance: '545516997964',
            date: '2024-08-31 09:20:22',
            recipient_type: '0',
            recipient_id: '0',
            binding_type: '15',
            binding_id: '400',
            comment: 'Test transaction',
            delete: '0',
            account_name: 'Cash',
            category_name: 'Sales',
            currency_symbol: '$'
          }
        },
        { upsert: true }
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('handles removed action (only stores raw, not in transactions)', async () => {
      const req = buildRequest({
        body: {
          object_id: 555,
          action: 'removed',
          data: '{"status":"3"}'
        }
      });
      const res = createMockResponse();

      await webhook(req as any, res as any);

      // Should NOT save to transactions for 'removed' action
      expect(updateTransaction).not.toHaveBeenCalled();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        object_id: 555,
        action: 'removed',
        saved_to_transactions: false,
        raw_hook_id: insertedId.toHexString()
      });
    });

    test('handles Poster API failure gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API timeout'));

      const req = buildRequest({
        body: {
          object_id: 7777,
          action: 'changed',
          data: '{"status":"2"}'
        }
      });
      const res = createMockResponse();

      await webhook(req as any, res as any);

      // Should NOT save to transactions when API fails
      expect(updateTransaction).not.toHaveBeenCalled();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        object_id: 7777,
        action: 'changed',
        saved_to_transactions: false,
        raw_hook_id: insertedId.toHexString()
      });
    });
  });
});
