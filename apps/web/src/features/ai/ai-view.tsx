'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  BarChart3,
  Zap,
  ChevronRight,
  Sparkles,
  Target,
  Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';

interface AiInsight {
  id: string;
  type: 'anomaly' | 'optimization' | 'prediction' | 'energy';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  recommendation: string;
  confidence: number;
  impact: string;
  equipmentId: string;
  detectedAt: string;
}

interface EquipmentHealth {
  machineId: string;
  name: string;
  health: number;
  trend: 'improving' | 'declining' | 'stable';
  risk: 'High' | 'Medium' | 'Low';
}

interface AiMetric {
  label: string;
  value: string;
  sub: string;
}

interface AiDetector {
  name: string;
  type: string;
  coverage: string;
  status: 'active' | 'idle';
}

interface AiInsightsResponse {
  metrics: AiMetric[];
  insights: AiInsight[];
  equipmentHealth: EquipmentHealth[];
  detectors: AiDetector[];
}

const typeConfig = {
  anomaly: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Anomaly' },
  optimization: { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Optimization' },
  prediction: { icon: Brain, color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Prediction' },
  energy: { icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Energy' },
};

const metricIcons = [Brain, AlertTriangle, TrendingUp, Target];

const severityColors = {
  high: 'text-red-400 border-red-500/30 bg-red-500/10',
  medium: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  low: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
};

export function AIView() {
  const { t } = useTranslation('modules');
  const [activeInsight, setActiveInsight] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['ai', 'insights'],
    queryFn: () => api.get<AiInsightsResponse>('/ai/insights'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const metrics = data?.metrics ?? [];
  const insights = data?.insights ?? [];
  const equipmentHealth = data?.equipmentHealth ?? [];
  const detectors = data?.detectors ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-brand-400" />
            {t('ai.title')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('ai.subtitle')}
          </p>
        </div>
        <Button size="sm" onClick={() => refetch()} disabled={isFetching}>
          <Brain className={cn('w-4 h-4 mr-2', isFetching && 'animate-pulse')} />
          {isFetching ? t('ai.analyzing') : t('ai.runAnalysis')}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-4">
                <div className="shimmer h-16 rounded-lg" />
              </div>
            ))
          : metrics.map((metric, i) => {
              const Icon = metricIcons[i % metricIcons.length];
              return (
                <div key={metric.label} className="glass-card rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-brand-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{metric.value}</div>
                      <div className="text-[11px] text-muted-foreground">{metric.sub}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{metric.label}</div>
                </div>
              );
            })}
      </div>

      <Tabs defaultValue="insights">
        <TabsList>
          <TabsTrigger value="insights">{t('ai.tabInsights')}</TabsTrigger>
          <TabsTrigger value="predictions">{t('ai.tabHealth')}</TabsTrigger>
          <TabsTrigger value="models">{t('ai.tabDetectors')}</TabsTrigger>
        </TabsList>

        <TabsContent value="insights" className="mt-4 space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-5">
                <div className="shimmer h-16 rounded-lg" />
              </div>
            ))
          ) : insights.length === 0 ? (
            <div className="glass-card rounded-xl p-10 text-center text-sm text-muted-foreground">
              {t('ai.noInsights')}
            </div>
          ) : (
            <AnimatedInsights insights={insights} activeInsight={activeInsight} setActiveInsight={setActiveInsight} />
          )}
        </TabsContent>

        <TabsContent value="predictions" className="mt-4">
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-brand-400" />
              {t('ai.healthIndex')}
            </h3>
            {isLoading ? (
              <div className="shimmer h-40 rounded-lg" />
            ) : equipmentHealth.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t('ai.noTelemetry')}
              </div>
            ) : (
              <div className="space-y-3">
                {equipmentHealth.map((eq) => (
                  <div key={eq.machineId} className="flex items-center gap-4">
                    <div className="w-40 text-sm truncate" title={eq.name}>{eq.name}</div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            eq.health >= 80 ? 'bg-green-500' : eq.health >= 60 ? 'bg-amber-500' : 'bg-red-500',
                          )}
                          style={{ width: `${eq.health}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-12 text-right text-sm font-mono">{eq.health}%</div>
                    <span className="w-20 text-[11px] text-muted-foreground flex items-center gap-1">
                      <TrendingUp
                        className={cn(
                          'w-3 h-3',
                          eq.trend === 'declining' ? 'text-red-400 rotate-180' :
                          eq.trend === 'improving' ? 'text-green-400' : 'text-muted-foreground',
                        )}
                      />
                      {t(`ai.trend.${eq.trend}`)}
                    </span>
                    <Badge
                      className={cn(
                        'text-[10px] w-16 justify-center',
                        eq.risk === 'High' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                        eq.risk === 'Medium' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                        'bg-green-500/20 text-green-400 border-green-500/30',
                      )}
                    >
                      {t(`ai.risk.${eq.risk}`)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="models" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {detectors.map((detector, i) => (
              <motion.div
                key={detector.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass-card rounded-xl p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-medium text-sm">{detector.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{detector.type}</div>
                  </div>
                  <Badge
                    className={cn(
                      'text-[10px]',
                      detector.status === 'active'
                        ? 'bg-green-500/20 text-green-400 border-green-500/30'
                        : 'bg-foreground/10 text-muted-foreground border-foreground/20',
                    )}
                  >
                    {t(`ai.detectorStatus.${detector.status}`)}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Activity className="w-3 h-3" />
                  {detector.coverage}
                </div>
              </motion.div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AnimatedInsights({
  insights,
  activeInsight,
  setActiveInsight,
}: {
  insights: AiInsight[];
  activeInsight: string | null;
  setActiveInsight: (id: string | null) => void;
}) {
  const { t } = useTranslation('modules');
  return (
    <>
      {insights.map((insight, i) => {
        const cfg = typeConfig[insight.type as keyof typeof typeConfig];
        const Icon = cfg.icon;
        const isActive = activeInsight === insight.id;
        return (
          <motion.div
            key={insight.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn(
              'glass-card rounded-xl overflow-hidden cursor-pointer transition-all',
              isActive ? 'ring-1 ring-brand-500' : 'hover:ring-1 hover:ring-white/20',
            )}
            onClick={() => setActiveInsight(isActive ? null : insight.id)}
          >
            <div className="p-5">
              <div className="flex items-start gap-4">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', cfg.bg)}>
                  <Icon className={cn('w-5 h-5', cfg.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-sm leading-snug">{insight.title}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={cn('text-[10px]', severityColors[insight.severity as keyof typeof severityColors])}>
                        {t(`ai.severity.${insight.severity}`)}
                      </Badge>
                      <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', isActive && 'rotate-90')} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">{t(`ai.cfg.${insight.type}`)}</Badge>
                    <span>{insight.equipmentId}</span>
                    <span>{insight.detectedAt}</span>
                    <span className="flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      {t('ai.confidence', { value: insight.confidence })}
                    </span>
                  </div>
                </div>
              </div>

              {isActive && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-4 pt-4 border-t border-border/50 space-y-3"
                >
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">{t('ai.analysis')}</div>
                    <p className="text-sm leading-relaxed">{insight.description}</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Lightbulb className="w-3 h-3" />
                        {t('ai.recommendation')}
                      </div>
                      <p className="text-sm text-brand-300">{insight.recommendation}</p>
                    </div>
                    <div className="shrink-0">
                      <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {t('ai.expectedImpact')}
                      </div>
                      <p className="text-sm text-green-400">{insight.impact}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm">{t('ai.acceptSchedule')}</Button>
                    <Button size="sm" variant="outline">{t('ai.dismiss')}</Button>
                    <Button size="sm" variant="ghost">{t('ai.viewDetails')}</Button>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        );
      })}
    </>
  );
}
