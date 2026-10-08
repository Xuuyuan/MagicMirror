import { hasMoreExamPages, mergeExamPages } from '@/src/services/exams';

const exam = (id: string) => ({ id, name: `考试-${id}` });
it('stops pagination on an empty page', () => expect(hasMoreExamPages([], [[exam('1')]])).toBe(false));
it('stops pagination when the provider repeats the previous page', () => expect(hasMoreExamPages([exam('1')], [[exam('1')]])).toBe(false));
it('continues pagination when a page contains a new exam', () => expect(hasMoreExamPages([exam('1'), exam('2')], [[exam('1')]])).toBe(true));
it('deduplicates exams while preserving the latest page value', () => expect(mergeExamPages([[exam('1')], [{ ...exam('1'), name: '更新后的考试' }, exam('2')]])).toEqual([{ ...exam('1'), name: '更新后的考试' }, exam('2')]))
