import type { ScoreProvider } from './types';
import { haofenshuParentProvider, haofenshuStudentProvider } from './haofenshu';
import { septnetProvider } from './septnet';
import { ruiyaProvider } from './ruiya';
import { bfzksProvider } from './bfzks';
import { zhuxuebangProvider } from './zhuxuebang';
import { haitunyuejuanProvider } from './haitunyuejuan';
const providers = new Map<string, ScoreProvider>([[haofenshuParentProvider.metadata.id, haofenshuParentProvider], [haofenshuStudentProvider.metadata.id, haofenshuStudentProvider], [septnetProvider.metadata.id, septnetProvider], [ruiyaProvider.metadata.id, ruiyaProvider], [bfzksProvider.metadata.id, bfzksProvider], [zhuxuebangProvider.metadata.id, zhuxuebangProvider], [haitunyuejuanProvider.metadata.id, haitunyuejuanProvider]]);
export const providerRegistry = { get(id: string) { return providers.get(id); }, list() { return [...providers.values()]; } };
