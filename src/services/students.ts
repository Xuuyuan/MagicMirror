import type { StudentProfile } from '../domain/models';

/**
 * 当前使用学生的下标：优先平台在绑定列表里标记的 `selected`，其次回退到账号保存的选择
 * （部分平台返回的列表不带 `selected`）。返回 -1 表示无法确定。
 */
export function selectedStudentIndex(profiles: readonly StudentProfile[] | undefined, selectedId: string | undefined): number {
  if (!profiles?.length) return -1;
  const marked = profiles.findIndex((profile) => profile.selected);
  if (marked >= 0) return marked;
  return selectedId ? profiles.findIndex((profile) => profile.id === selectedId) : -1;
}

/**
 * 首页平台标签：账号绑定多个学生时标出当前使用的是第几个（与切换菜单里的（n）一致），
 * 只有一个学生或列表尚未取到时不加后缀。
 */
export function studentProviderLabel(providerName: string, profiles: readonly StudentProfile[] | undefined, selectedId: string | undefined): string {
  const index = selectedStudentIndex(profiles, selectedId);
  return profiles && profiles.length > 1 && index >= 0 ? `${providerName}-${index + 1}` : providerName;
}

/**
 * 切换学生入口是否显示：已知没有或只有一个学生（无从切换）时隐藏；首次加载还没取到列表时先不显示，
 * 避免单学生账号闪一下；读取失败（未取到列表）时保留入口，菜单里仍有“读取失败，点击重试”。
 */
export function studentSwitcherVisible(profiles: readonly StudentProfile[] | undefined, pending: boolean): boolean {
  if (profiles !== undefined) return profiles.length > 1;
  return !pending;
}
