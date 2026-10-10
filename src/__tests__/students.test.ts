import { selectedStudentIndex, studentProviderLabel } from '../services/students';
import type { StudentProfile } from '../domain/models';

// 全部为虚构数据（仅结构与平台返回一致），不含任何真实学生信息。
const boundStudents: StudentProfile[] = [
  { id: '21', displayName: '林测测' },
  { id: '22', displayName: '林测测', schoolName: '虚构第一中学' },
];
/** 平台在列表里标记了 selected（与只有一个学生时平台不返回标记的情况对应）。 */
const markedSelected: StudentProfile[] = [
  { id: '21', displayName: '林测测' },
  { id: '22', displayName: '林测测', selected: true },
];

describe('当前学生下标', () => {
  it('平台标记 selected 时以标记为准，即使账号里保存的是另一个', () => {
    expect(selectedStudentIndex(markedSelected, '21')).toBe(1);
  });

  it('平台未标记 selected 时回退到账号保存的选择', () => {
    expect(selectedStudentIndex(boundStudents, '21')).toBe(0);
    expect(selectedStudentIndex(boundStudents, '22')).toBe(1);
  });

  it('列表缺失、为空或选择不在列表里时返回 -1', () => {
    expect(selectedStudentIndex(undefined, '22')).toBe(-1);
    expect(selectedStudentIndex([], '22')).toBe(-1);
    expect(selectedStudentIndex(boundStudents, '99')).toBe(-1);
    expect(selectedStudentIndex(boundStudents, undefined)).toBe(-1);
  });
});

describe('首页平台标签', () => {
  it('多学生时显示当前使用的是第几个，并随切换变化', () => {
    expect(studentProviderLabel('海豚阅卷', markedSelected, undefined)).toBe('海豚阅卷-2');
    expect(studentProviderLabel('海豚阅卷', boundStudents, '21')).toBe('海豚阅卷-1');
    expect(studentProviderLabel('海豚阅卷', boundStudents, '22')).toBe('海豚阅卷-2');
  });

  it('只有一个学生或列表尚未取到时不加后缀', () => {
    expect(studentProviderLabel('好分数', [{ id: '21', displayName: '林测测' }], undefined)).toBe('好分数');
    expect(studentProviderLabel('海豚阅卷', undefined, '22')).toBe('海豚阅卷');
  });

  it('选择不在列表中（如学生已解绑）时不加后缀', () => {
    expect(studentProviderLabel('海豚阅卷', boundStudents, '99')).toBe('海豚阅卷');
  });
});
