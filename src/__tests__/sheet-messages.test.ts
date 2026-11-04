import {
  archivedSheetRestoringMessage,
  archivedSheetRestoringText,
} from '../services/sheet-messages';

it.each([
  [0, '1 分钟'],
  [90, '2 分钟'],
  [3599, '1 小时'],
  [3600, '1 小时'],
  [7200, '2 小时'],
  [19767, '5 小时 29 分钟'],
])('formats %s remaining seconds as %s', (seconds, label) => {
  expect(archivedSheetRestoringText(seconds)).toBe(
    `该考试已被平台归档，正在恢复中，预计还需 ${label}，请稍后再来查看。`,
  );
});

it('falls back to the generic six-hour message without a usable remaining time', () => {
  expect(archivedSheetRestoringText()).toBe(archivedSheetRestoringMessage);
  expect(archivedSheetRestoringText(Number.NaN)).toBe(archivedSheetRestoringMessage);
  expect(archivedSheetRestoringText(Number.POSITIVE_INFINITY)).toBe(archivedSheetRestoringMessage);
  expect(archivedSheetRestoringText(-1)).toBe(archivedSheetRestoringMessage);
});
