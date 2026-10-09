import { createFileRoute } from '@tanstack/react-router';
import { StatisticsPage } from '@renderer/features/statistics/StatisticsPage';

export const Route = createFileRoute('/_app/statistics')({ component: StatisticsPage });
