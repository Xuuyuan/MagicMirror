/** 页面文案独立成模块，避免界面为了展示提示而连带加载图片下载依赖。 */
export const archivedSheetMessage =
  '该考试的图片已被平台归档，暂时无法读取，请前往智学网官方 App 查看。';
export const archivedSheetColdMessage =
  '该考试已被平台归档。若需读取，请点击底下按钮进行恢复，恢复流程大约需要 6 小时。';
export const archivedSheetDeepMessage =
  '该考试已被平台归档，无法读取。若需读取，请通过智学网官方 APP 联系客服。';
export const archivedSheetRestoringMessage =
  '该考试已被平台归档，恢复申请已提交，系统约需 6 小时完成，请稍后再来查看。';
/** 有平台剩余秒数时显示具体时长；缺失或无效时回退到约 6 小时的通用文案。 */
export function archivedSheetRestoringText(remainingSeconds?: number): string {
  if (remainingSeconds === undefined || !Number.isFinite(remainingSeconds) || remainingSeconds < 0)
    return archivedSheetRestoringMessage;
  const minutes = Math.max(1, Math.round(remainingSeconds / 60));
  if (minutes < 60)
    return `该考试已被平台归档，正在恢复中，预计还需 ${minutes} 分钟，请稍后再来查看。`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `该考试已被平台归档，正在恢复中，预计还需 ${hours} 小时${rest ? ` ${rest} 分钟` : ''}，请稍后再来查看。`;
}
export const archivedSheetStateUnavailableMessage =
  '暂时无法确认该考试图片的归档状态，请稍后重新获取。';
export const sheetImageFailureMessage = '图片无法加载或与作答区域不匹配，请关闭后重新获取。';
