'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

interface QualityTrendProps {
  data?: Array<{ time: string; fpy: number; rework: number; scrap: number }>;
  isLoading?: boolean;
}

export function QualityTrendChart({ data, isLoading }: QualityTrendProps) {
  const { t } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo(() => {
    const textColor = isDark ? '#ffffff50' : '#00000050';
    const gridColor = isDark ? '#ffffff10' : '#00000010';

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#1a1f2e' : '#ffffff',
        borderColor: isDark ? '#ffffff10' : '#00000010',
        textStyle: { color: isDark ? '#ffffff90' : '#000000', fontSize: 11 },
      },
      legend: {
        data: ['FPY %', 'Rework %', 'Scrap %'],
        textStyle: { color: textColor, fontSize: 10 },
        right: 0, top: 0,
        icon: 'circle',
        itemWidth: 8, itemHeight: 8,
      },
      grid: { top: 36, left: 10, right: 10, bottom: 20, containLabel: true },
      xAxis: {
        type: 'category',
        data: data?.map((d) => d.time) ?? [],
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: gridColor } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 80,
        max: 100,
        axisLabel: { color: textColor, fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: gridColor } },
        axisLine: { show: false },
      },
      series: [
        {
          name: 'FPY %',
          type: 'line',
          data: data?.map((d) => d.fpy) ?? [],
          lineStyle: { color: '#22c55e', width: 2 },
          symbol: 'circle', symbolSize: 4,
          smooth: true,
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: '#22c55e25' }, { offset: 1, color: 'transparent' }] },
          },
        },
        {
          name: 'Rework %',
          type: 'line',
          data: data?.map((d) => d.rework) ?? [],
          lineStyle: { color: '#f59e0b', width: 2, type: 'dashed' },
          symbol: 'none', smooth: true,
        },
        {
          name: 'Scrap %',
          type: 'line',
          data: data?.map((d) => d.scrap) ?? [],
          lineStyle: { color: '#f43f5e', width: 2, type: 'dashed' },
          symbol: 'none', smooth: true,
        },
      ],
    };
  }, [data, isDark]);

  return (
    <div className="industrial-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{t('charts.qualityTrend')}</h3>
        <p className="text-xs text-muted-foreground">{t('charts.fpyDefects')}</p>
      </div>
      {isLoading ? (
        <div className="shimmer h-48 rounded-lg" />
      ) : (
        <ReactECharts option={option} style={{ height: '200px' }} notMerge />
      )}
    </div>
  );
}
