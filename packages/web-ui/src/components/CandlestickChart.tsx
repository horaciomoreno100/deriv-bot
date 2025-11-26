/**
 * Candlestick Chart Component usando Lightweight Charts
 * Muestra velas en tiempo real con soporte para indicadores y señales
 */

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData } from 'lightweight-charts';
import type { Candle } from '@deriv-bot/shared';
import './CandlestickChart.css';

export interface ChartIndicators {
  rsi?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  atr?: number;
}

export interface TradeMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown';
  text: string;
}

interface CandlestickChartProps {
  candles: Candle[];
  indicators?: ChartIndicators;
  trades?: TradeMarker[];
  title?: string;
  onLoadMore?: (oldestTimestamp: number) => Promise<void>; // Callback to load more historical data
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  candles,
  indicators,
  trades = [],
  title = 'Live Chart',
  onLoadMore,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const isLoadingMoreRef = useRef(false); // Prevent multiple simultaneous loads

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { color: '#0e0e0e' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    candleSeriesRef.current = candleSeries;

    // Bollinger Bands
    const bbUpperSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 1,
      lineStyle: 2, // dashed
      title: 'BB Upper',
    });
    bbUpperSeriesRef.current = bbUpperSeries;

    const bbMiddleSeries = chart.addLineSeries({
      color: '#8b5cf6',
      lineWidth: 1,
      lineStyle: 2,
      title: 'BB Middle',
    });
    bbMiddleSeriesRef.current = bbMiddleSeries;

    const bbLowerSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 1,
      lineStyle: 2,
      title: 'BB Lower',
    });
    bbLowerSeriesRef.current = bbLowerSeries;

    setChartReady(true);

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Load/reload all candles when dataset changes significantly
  // This handles: initial load, historical data pagination
  const prevCandlesLengthRef = useRef(0);
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current || candles.length === 0) return;

    // Check if this is a significant change (more than 1 candle difference)
    // This detects historical data loads but ignores single real-time updates
    const lengthDiff = Math.abs(candles.length - prevCandlesLengthRef.current);
    const isSignificantChange = lengthDiff > 1 || prevCandlesLengthRef.current === 0;

    if (isSignificantChange) {
      console.log('[Chart] Reloading all candles with setData');
      const chartData: CandlestickData[] = candles.map((candle) => ({
        time: candle.timestamp as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      candleSeriesRef.current.setData(chartData);
      prevCandlesLengthRef.current = candles.length;

      // On initial load, scroll to most recent (right side)
      if (prevCandlesLengthRef.current === candles.length && chartRef.current) {
        setTimeout(() => {
          chartRef.current?.timeScale().scrollToRealTime();
        }, 100);
      }
    }
  }, [candles, chartReady]);

  // Setup infinite scroll to load more historical data
  useEffect(() => {
    if (!chartReady || !chartRef.current || !onLoadMore) return;

    const handleVisibleRangeChange = async (logicalRange: any) => {
      // If user scrolled close to the left edge (within 50 bars)
      if (logicalRange !== null && logicalRange.from < 50) {
        // Prevent multiple simultaneous loads
        if (isLoadingMoreRef.current) return;
        if (candles.length === 0) return;

        isLoadingMoreRef.current = true;
        console.log('[Chart] Loading more historical data...');

        try {
          // Get the timestamp of the oldest candle
          const oldestTimestamp = candles[0].timestamp;
          await onLoadMore(oldestTimestamp);
        } catch (error) {
          console.error('[Chart] Failed to load more data:', error);
        } finally {
          isLoadingMoreRef.current = false;
        }
      }
    };

    const timeScale = chartRef.current.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    };
  }, [chartReady, onLoadMore, candles]);

  // Update chart in real-time using update() method (for small changes)
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current || candles.length === 0) return;

    // Only use update() for small changes (real-time ticks)
    const lengthDiff = Math.abs(candles.length - prevCandlesLengthRef.current);
    if (lengthDiff <= 1) {
      const latestCandle = candles[candles.length - 1];
      const candleData: CandlestickData = {
        time: latestCandle.timestamp as any,
        open: latestCandle.open,
        high: latestCandle.high,
        low: latestCandle.low,
        close: latestCandle.close,
      };

      // Use update() for real-time updates (adds or updates last candle)
      candleSeriesRef.current.update(candleData);
      prevCandlesLengthRef.current = candles.length;
    }

    // Don't auto-scroll - let user control the view
  }, [candles, chartReady]);

  // Update indicators (Bollinger Bands)
  useEffect(() => {
    if (!chartReady || !indicators || candles.length === 0) return;

    // BB Upper
    if (indicators.bbUpper && bbUpperSeriesRef.current) {
      const bbUpperData: LineData[] = candles.map((candle) => ({
        time: candle.timestamp as any, // Timestamp is already in seconds
        value: indicators.bbUpper!,
      }));
      bbUpperSeriesRef.current.setData(bbUpperData);
    }

    // BB Middle
    if (indicators.bbMiddle && bbMiddleSeriesRef.current) {
      const bbMiddleData: LineData[] = candles.map((candle) => ({
        time: candle.timestamp as any, // Timestamp is already in seconds
        value: indicators.bbMiddle!,
      }));
      bbMiddleSeriesRef.current.setData(bbMiddleData);
    }

    // BB Lower
    if (indicators.bbLower && bbLowerSeriesRef.current) {
      const bbLowerData: LineData[] = candles.map((candle) => ({
        time: candle.timestamp as any, // Timestamp is already in seconds
        value: indicators.bbLower!,
      }));
      bbLowerSeriesRef.current.setData(bbLowerData);
    }
  }, [indicators, candles, chartReady]);

  // Update trade markers
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current || trades.length === 0) return;

    const markers = trades.map((trade) => ({
      time: Math.floor(trade.time / 1000) as any,
      position: trade.position,
      color: trade.color,
      shape: trade.shape,
      text: trade.text,
    }));

    candleSeriesRef.current.setMarkers(markers as any);
  }, [trades, chartReady]);

  return (
    <div className="candlestick-chart">
      <div className="chart-header">
        <h2>{title}</h2>
        {indicators && (
          <div className="indicators-display">
            {indicators.rsi && <span className="indicator">RSI: {indicators.rsi.toFixed(1)}</span>}
            {indicators.bbUpper && <span className="indicator">BB Upper: {indicators.bbUpper.toFixed(2)}</span>}
            {indicators.bbMiddle && <span className="indicator">BB Mid: {indicators.bbMiddle.toFixed(2)}</span>}
            {indicators.bbLower && <span className="indicator">BB Lower: {indicators.bbLower.toFixed(2)}</span>}
            {indicators.atr && <span className="indicator">ATR: {indicators.atr.toFixed(2)}</span>}
          </div>
        )}
      </div>
      <div ref={chartContainerRef} className="chart-container" />
    </div>
  );
};
