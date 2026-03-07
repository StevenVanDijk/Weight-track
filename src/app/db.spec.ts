// Use fake-indexeddb so these tests work in JSDOM (which lacks a real IndexedDB global)
import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { DbService } from './db';

describe('DbService (IndexedDB wrapper)', () => {
  let db: DbService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    db = TestBed.inject(DbService);
  });

  it('read returns undefined for an unknown key', async () => {
    expect(await db.read('nonexistent-key')).toBeUndefined();
  });

  it('write then read round-trips a primitive value', async () => {
    await db.write('test-number', 42);
    expect(await db.read('test-number')).toBe(42);
  });

  it('write then read round-trips an array', async () => {
    const arr = [{ id: '1', date: '2024-01-01', weight: 80 }];
    await db.write('test-array', arr);
    expect(await db.read('test-array')).toEqual(arr);
  });

  it('write then read round-trips an object', async () => {
    const obj = { goalWeight: 70, reminderEnabled: false };
    await db.write('test-obj', obj);
    expect(await db.read('test-obj')).toEqual(obj);
  });

  it('write overwrites a previously stored value for the same key', async () => {
    await db.write('overwrite-key', 'first');
    await db.write('overwrite-key', 'second');
    expect(await db.read('overwrite-key')).toBe('second');
  });

  it('different keys do not interfere with each other', async () => {
    await db.write('key-a', 'alpha');
    await db.write('key-b', 'beta');
    expect(await db.read('key-a')).toBe('alpha');
    expect(await db.read('key-b')).toBe('beta');
  });

  it('write can store null', async () => {
    await db.write('null-key', null);
    expect(await db.read('null-key')).toBeNull();
  });

  it('multiple sequential writes to the same key keep the last value', async () => {
    for (let i = 0; i < 5; i++) await db.write('seq-key', i);
    expect(await db.read('seq-key')).toBe(4);
  });
});
