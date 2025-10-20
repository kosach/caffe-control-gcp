import { ObjectId } from 'mongodb';
import { webhook } from './index';

jest.mock('../../utils/mongodb', () => ({
  connectToDatabase: jest.fn(),
  getSecret: jest.fn()
}));

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

    (getSecret as jest.Mock).mockResolvedValue('valid-key');
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

  test('returns 400 when data missing', async () => {
    const req = buildRequest({
      body: {
        action: 'created'
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(updateRaw).toHaveBeenCalledWith(
      { _id: insertedId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.processing_error': 'Missing required field: data'
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: 'Missing required field: data'
    });
  });

  test('returns 400 when transaction_id invalid', async () => {
    const req = buildRequest({
      body: {
        action: 'created',
        data: { transaction_id: 'abc' }
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(updateRaw).toHaveBeenCalledWith(
      { _id: insertedId },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.processing_error': 'Missing or invalid field: data.transaction_id'
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid payload',
      details: 'Missing or invalid field: data.transaction_id'
    });
  });

  test('stores raw webhook and skips transactions for created action', async () => {
    const req = buildRequest();
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
      transaction_id: 123,
      action: 'created',
      saved_to_transactions: false,
      raw_hook_id: insertedId.toHexString()
    });
  });

  test('upserts transaction when action is closed', async () => {
    const req = buildRequest({
      body: {
        action: 'closed',
        data: {
          transaction_id: 999,
          status: '2',
          payed_sum: '7500'
        }
      }
    });
    const res = createMockResponse();

    await webhook(req as any, res as any);

    expect(updateTransaction).toHaveBeenCalledWith(
      { transaction_id: 999 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: '2',
          payed_sum: '7500',
          webhook_action: 'closed',
          raw_hook_id: insertedId
        })
      }),
      { upsert: true }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      transaction_id: 999,
      action: 'closed',
      saved_to_transactions: true,
      raw_hook_id: insertedId.toHexString()
    });
  });

  test('returns 500 when transaction upsert fails', async () => {
    updateTransaction.mockRejectedValueOnce(new Error('Write error'));

    const req = buildRequest({
      body: {
        action: 'closed',
        data: { transaction_id: 42 }
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

      // Should save to transactions because 'changed' maps to 'closed'
      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: 16776 },
        expect.objectContaining({
          $set: expect.objectContaining({
            transaction_id: 16776,
            status: '2',
            payed_sum: '5000',
            poster_account: 'mykava6',
            poster_object: 'transaction',
            poster_time: '1688722229',
            webhook_action: 'closed'
          })
        }),
        { upsert: true }
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        transaction_id: 16776,
        action: 'changed', // Returns original action
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

      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: 99999 },
        expect.objectContaining({
          $set: expect.objectContaining({
            transaction_id: 99999,
            transactions_history: {
              type_history: 'additem',
              time: 1688722229115
            }
          })
        }),
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

      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: 88888 },
        expect.objectContaining({
          $set: expect.objectContaining({
            transaction_id: 88888,
            status: '2',
            amount: 1500
          })
        }),
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

      // Should still save with raw data string
      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: 77777 },
        expect.objectContaining({
          $set: expect.objectContaining({
            transaction_id: 77777,
            raw_data_string: '{invalid json}'
          })
        }),
        { upsert: true }
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('preserves backwards compatibility with simplified format', async () => {
      const req = buildRequest({
        body: {
          action: 'closed',
          data: {
            transaction_id: 555,
            status: '2'
          }
        }
      });
      const res = createMockResponse();

      await webhook(req as any, res as any);

      expect(updateTransaction).toHaveBeenCalledWith(
        { transaction_id: 555 },
        expect.objectContaining({
          $set: expect.objectContaining({
            transaction_id: 555,
            status: '2',
            webhook_action: 'closed'
          })
        }),
        { upsert: true }
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        transaction_id: 555,
        action: 'closed',
        saved_to_transactions: true,
        raw_hook_id: insertedId.toHexString()
      });
    });
  });
});
