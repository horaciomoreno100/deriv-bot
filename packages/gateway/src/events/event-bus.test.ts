import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from './event-bus.js';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = EventBus.getInstance();
    eventBus.removeAllListeners();
  });

  it('should be a singleton', () => {
    const instance1 = EventBus.getInstance();
    const instance2 = EventBus.getInstance();

    expect(instance1).toBe(instance2);
  });

  it('should emit and receive events', () => {
    const listener = vi.fn();

    eventBus.on('test:event', listener);
    eventBus.emit('test:event', { data: 'test' });

    expect(listener).toHaveBeenCalledWith({ data: 'test' });
  });

  it('should support multiple listeners', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    eventBus.on('test:event', listener1);
    eventBus.on('test:event', listener2);

    eventBus.emit('test:event', { data: 'test' });

    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });

  it('should remove listeners', () => {
    const listener = vi.fn();

    eventBus.on('test:event', listener);
    eventBus.off('test:event', listener);

    eventBus.emit('test:event', { data: 'test' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('should support once listeners', () => {
    const listener = vi.fn();

    eventBus.once('test:event', listener);

    eventBus.emit('test:event', { data: 'first' });
    eventBus.emit('test:event', { data: 'second' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ data: 'first' });
  });

  it('should emit tick events', () => {
    const listener = vi.fn();

    eventBus.on('tick', listener);

    eventBus.emit('tick', {
      asset: 'R_100',
      price: 1234.56,
      timestamp: Date.now(),
    });

    expect(listener).toHaveBeenCalled();
  });

  it('should emit candle events', () => {
    const listener = vi.fn();

    eventBus.on('candle:update', listener);

    eventBus.emit('candle:update', {
      asset: 'R_100',
      timeframe: 60,
      candle: {
        timestamp: Date.now(),
        open: 1234.5,
        high: 1235.0,
        low: 1234.0,
        close: 1234.8,
      },
    });

    expect(listener).toHaveBeenCalled();
  });
});
