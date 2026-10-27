import { z } from 'zod';
import { ecb, gcm } from '@noble/ciphers/aes.js';
import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes } from 'expo-crypto';
import {
  ProviderError,
  type AnswerSheet,
  type AuthSession,
  type ClaimCandidate,
  type EssayDetail,
  type ExamResult,
  type ReportSection,
  type SubjectStatistic,
  type UnclaimedExam,
} from '../domain/models';
import { distributionSection, essaySection } from './septnet-report';
import type { ProviderRequestOptions, ScoreProvider } from './types';
import { requestWithTimeout, throwIfAborted, type FetchTransport } from '../services/http';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  numericScore,
  parseValidated,
  rsaEncryptPkcs1 as rsaEncryptPkcs1WithKey,
  utf8ToBytes,
} from './codec';

// 编解码原语与七天学堂自己的实现一致；此处重新导出，供加密层测试直接引用。
export { base64ToBytes, bytesToBase64, bytesToUtf8, numericScore, utf8ToBytes } from './codec';

/**
 * 七天学堂（七天网络 / szone）直连 Provider。
 *
 * 协议与字段形态全部来自运行时实测（见 analysis/7net/live-verification.md §16），要点：
 * - 加密请求：参数串 "k=v;k=v" 经 AES-256-GCM 加密放入 `bp`，随机 nonce 放入 `bn`，
 *   会话密钥的 RSA 封装放入 `bk`，body 为空；`bk` 由服务端逐请求解密并用作该次请求的密钥。
 * - 响应两种信封：`data.bn` + `data.content` = 会话密钥 GCM；`data.isEncrypt` + `data.content`
 *   = 平台内置静态密钥 ECB。判断顺序必须是「先 bn 后 isEncrypt」。
 * - HTTP 层恒 200，语义错误在 body 的 `status`（可能是字符串）。
 */
const host = 'https://szone-my.7net.cc/';
const scoreHost = 'https://szone-score.7net.cc/';
// 小程序接口面：明文表单 + token/version 参数，与 App 登录共用同一 token（见 analysis/qitianxuetang/interface-audit.md）。
const publicHost = 'https://szone-public.7net.cc/';
const version = '4.6.4';
/** 固定协议：不要修改命名空间、规范化规则或截断长度，避免已有账号的标识变化。 */
export async function septnetOpenId(account: string): Promise<string> {
  return (
    await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      'magicmirror:septnet:miniapp:openid:v1:' + account.trim(),
    )
  ).slice(0, 28);
}
// 实测：App 用 WebView UA 发请求；固定为该形态即可通过。
const userAgent =
  'Mozilla/5.0 (Linux; Android 12; ALA-AN70 Build/V417IR; wv) AppleWebKit/537.36' +
  ' (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Mobile Safari/537.36';

/**
 * 平台协议常量（与官方客户端一致；均非本项目自有数据）：
 * - `passwordSuffix`：官方 App 的口令编码后缀（`base64(明文口令 + 后缀)`）。
 * - `rsaModulus`：密钥封装公钥（1024-bit，e=65537）。公钥本身是公开信息。
 * - `staticResponseKey`：解密「模式 B」响应用的平台内置对称密钥，
 *   由项目负责人明确决定内置（2026-09-28）；仅用于解密本人账号的响应。
 */
const passwordSuffix = '{MTgyMjU2MDU0MjF7c3pvbmV9}';
const rsaModulus = BigInt(
  '0x' +
    'eb8c4705556bba9a2cd2c8fddf08269667705e4deb99c78e071dc5a1ceaebe16' +
    '4b9e0293896e27e2d157da50ee92f5e1ef689484682505a2e0f7731af77ce93c' +
    '458430d52d41713b1c11b9eaabf3c2ba88f9be3d76b7f33775ba9374d282aee7' +
    'd2ba4c016ac93e38e1de9eef48273926beb3eeacb9c80b7c834f2dc8c7d62589',
);
const rsaExponent = 65537n;
export const platformResponseKey = utf8ToBytes('c0f1a30cba2147949ee71cf71cba3c20');
const staticResponseKey = platformResponseKey;

/** 平台固定的 1024 位密钥封装公钥（公开参数，见上方说明）。 */
export function rsaEncryptPkcs1(
  message: Uint8Array,
  random: (size: number) => Uint8Array,
): Uint8Array {
  return rsaEncryptPkcs1WithKey(message, rsaModulus, rsaExponent, random);
}

const tokenSchema = z.string().regex(/^[A-Za-z0-9_]{16,}$/);
const envelopeSchema = z.object({
  status: z.union([z.number().int(), z.string()]),
  message: z.string().optional(),
  data: z.unknown().optional(),
});
const sealedSchema = z.object({
  bn: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  isEncrypt: z.boolean().optional(),
});
const loginSchema = z.object({ token: tokenSchema });
const profileSchema = z.object({
  userGuid: z.string().optional(),
  studentGuid: z.string().optional(),
  nickName: z.string().optional(),
  studentName: z.string().optional(),
  schoolName: z.string().optional(),
  grade: z.string().optional(),
  currentGrade: z.string().optional(),
  schoolGuid: z.string().optional(),
  ruCode: z.string().optional(),
});
const examItemSchema = z.object({
  examGuid: z.string().min(1),
  examName: z.string().min(1),
  time: z.string().optional(),
  // 实测：`type` 是平台自带的考试性质短标签（如「周测」「月考」），官方客户端把它原样渲染成角标。
  type: z.string().max(16).optional(),
  authView: z.number().int().optional(),
  ruleHash: z.string().optional(),
});
const examPageSchema = z.object({
  startIndex: z.number().int().optional(),
  list: z.array(examItemSchema),
});
const unclaimedPageSchema = z.array(
  z.object({
    month: z.string().optional(),
    list: z.array(
      z.object({
        examGuid: z.string().min(1),
        examName: z.string().min(1),
        time: z.string().optional(),
        studentCodeList: z.array(z.string().min(1)),
      }),
    ),
  }),
);
const claimCandidateSchema = z.array(
  z.object({ studentCode: z.string().min(1), url: z.string().url().optional() }),
);
const configSchema = z.object({
  config: z.object({ CloseCF: z.boolean().optional() }).optional(),
  charge: z.object({ ShowPosition: z.boolean().optional() }).optional(),
});
const essaySchema = z.object({
  th: z.string().optional(),
  score: z.string().optional(),
  full: z.string().optional(),
  avg: z.string().optional(),
  max: z.string().optional(),
  diff: z.string().optional(),
  highCount: z.string().optional(),
});
const subjectSchema = z.object({
  km: z.string().min(1),
  code: z.number().int().optional(),
  codeDesc: z.string().optional(),
  responseGuid: z.string().optional(),
  srcKm: z.string().optional(),
  // 语文/英语等含作文的科目会带 essayThInfo（官方「作文」卡片数据源：score/full/avg/max 均为字符串）。
  ai_essay_report: z
    .object({
      essayThInfo: essaySchema.optional(),
    })
    .optional(),
});
const subjectsSchema = z.object({
  exam_info: z
    .object({
      studentCount: z.string().optional(),
      examPublishType: z.number().int().optional(),
      queryTime: z.string().optional(),
      isUnion: z.boolean().optional(),
      kmCount: z.number().int().optional(),
    })
    .optional(),
  list: z.array(subjectSchema),
});
// 官方响应的科目满分可能是数字，总分满分则可能是字符串；统一后复用保守分数解析。
const fullScoreSchema = z.union([z.string(), z.number().finite()]).transform(String).optional();
const reportRowSchema = z.object({
  km: z.string().min(1),
  kmTag: z.number().int().optional(),
  score: z.string().optional(),
  fullScore: fullScoreSchema,
  fuScore: z.string().optional(),
  fuFullScore: fullScoreSchema,
  fuTag: z.boolean().optional(),
  isFu: z.number().int().optional(),
  grade: z.string().optional(),
  rating: z.string().optional(),
});
const answerCardSchema = z.object({
  answerUrls: z.array(z.string().min(1)).optional(),
  isWatermark: z.boolean().optional(),
});
const reportSchema = z.object({
  km_info: z
    .object({
      score: z.string().optional(),
      fullScore: fullScoreSchema,
      grade: z.string().optional(),
    })
    .optional(),
  km_list: z.array(reportRowSchema).optional(),
  other: z
    .object({
      tips: z.string().optional(),
      totalSubjects: z.string().optional(),
      fuTotalSubjects: z.string().optional(),
    })
    .optional(),
});
const essayResponseSchema = z.object({ essayThInfo: essaySchema.optional() });
const distributionSchema = z.array(
  z.object({
    th: z.string().min(1),
    sort: z.number().finite().optional(),
    distri: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
);
// 试卷原卷：按科目下发的扫描图地址（itembank OSS 签名直链，实测短期有效）。
const paperSchema = z.array(
  z.object({ subject: z.string().min(1), imgUrls: z.array(z.string().min(1)).optional() }),
);
// 作文：作答切图（myAnswers）与得分统计；pdf 相关字段实测多为空，同样保守解析。
const essayReportSchema = z.object({
  th: z.string().optional(),
  score: z.string().optional(),
  full: z.string().optional(),
  avg: z.string().optional(),
  max: z.string().optional(),
  diff: z.string().optional(),
  highCount: z.string().optional(),
  myAnswers: z.array(z.string().min(1)).optional(),
  pdfImgs: z.array(z.string().min(1)).optional(),
});
const essayStemSchema = z.object({
  questionStemTxt: z.string().optional(),
  uploadImg: z.string().optional(),
});
// 旧版接口的科目统计：`report.total` 经项目负责人确认为「校内参加本科目考试的考生人数」（是本科目，不是本场考试）。
const subjectGradeSchema = z.object({
  report: z.object({ total: z.number().finite().optional() }).optional(),
});
const studentCodeSchema = z.object({ studentCode: z.string().optional() });

function parse<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  return parseValidated(schema, raw, `七天学堂${label}结构不符合预期`);
}

function assignedScore(row: z.infer<typeof reportRowSchema> | undefined): number | undefined {
  if (!row || (row.isFu !== 1 && row.fuTag !== true)) return undefined;
  const score = numericScore(row.fuScore);
  return score !== undefined && score >= 0 ? score : undefined;
}

// 按项目负责人提供的等第区间（从高到低的比例带，单位 %），展示串由此派生，不推算个人精确名次。
const gradeBands: Readonly<Record<string, { min: number; max: number }>> = {
  A1: { min: 0, max: 1 },
  A2: { min: 1, max: 3 },
  A3: { min: 3, max: 6 },
  A4: { min: 6, max: 10 },
  A5: { min: 10, max: 15 },
  B1: { min: 15, max: 21 },
  B2: { min: 21, max: 28 },
  B3: { min: 28, max: 36 },
  B4: { min: 36, max: 43 },
  B5: { min: 43, max: 50 },
  C1: { min: 50, max: 56 },
  C2: { min: 56, max: 64 },
  C3: { min: 64, max: 71 },
  C4: { min: 71, max: 78 },
  C5: { min: 78, max: 84 },
  D1: { min: 84, max: 89 },
  D2: { min: 89, max: 93 },
  D3: { min: 93, max: 96 },
  D4: { min: 96, max: 98 },
  D5: { min: 98, max: 99 },
  E: { min: 99, max: 100 },
};

// 平台可能下发带次级的等第；按项目负责人确认，E1 视同等第 E（区间表只有 E）。
const gradeAliases: Readonly<Record<string, string>> = { E1: 'E' };

function gradeBand(grade: string | undefined): { min: number; max: number } | undefined {
  const code = (grade ?? '').trim().toUpperCase();
  const key = gradeAliases[code] ?? code;
  return Object.hasOwn(gradeBands, key) ? gradeBands[key] : undefined;
}

function gradePercentileText(grade: string | undefined): string | undefined {
  const band = gradeBand(grade);
  return band ? (band.min === 0 ? `前${band.max}%` : `${band.min}-${band.max}%`) : undefined;
}

function businessError(status: number | string): ProviderError {
  const code = Number(status);
  if (code === 401 || code === 403)
    return new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
  if (code === 404) return new ProviderError('NOT_FOUND', '该考试不属于当前账号或尚未认领');
  if (code === 405) return new ProviderError('NOT_FOUND', '该接口已停止提供');
  if (code === 4033) return new ProviderError('UNSUPPORTED', '平台拒绝了本次请求');
  return new ProviderError('UNKNOWN', '七天学堂暂时无法完成此请求');
}

function toParamString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join(';');
}

export interface SeptnetOptions {
  transport?: FetchTransport;
  /** 仅供测试注入；默认使用 expo-crypto 的同步随机源。 */
  random?: (size: number) => Uint8Array;
}

export function createSeptnetProvider(options: SeptnetOptions = {}): ScoreProvider {
  const providerId = 'septnet';
  const transport: FetchTransport = options.transport ?? ((...args) => fetch(...args));
  const random = options.random ?? ((size: number) => getRandomBytes(size));
  // 弱引用让交出去的会话在本地失效，而不必长期持有 token。
  const revoked = new WeakSet<AuthSession>();

  function assertSession(session: AuthSession): void {
    if (
      session.providerId !== providerId ||
      revoked.has(session) ||
      !tokenSchema.safeParse(session.accessToken).success ||
      (session.expiresAt !== undefined && session.expiresAt <= Date.now())
    ) {
      throw new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
    }
  }

  function context(session: AuthSession): {
    schoolGuid: string;
    grade: string;
    ruCode: string;
    studentName?: string;
    cookie?: string;
  } {
    assertSession(session);
    const schoolGuid = session.providerContext?.['schoolGuid'];
    const grade = session.providerContext?.['grade'];
    if (!schoolGuid || !grade) {
      throw new ProviderError('SESSION_EXPIRED', '学校信息不完整，请重新登录');
    }
    return {
      schoolGuid,
      grade,
      ruCode: session.providerContext?.['ruCode'] ?? '',
      studentName: session.providerContext?.['studentName'],
      cookie: session.providerContext?.['wafCookie'],
    };
  }

  function headers(
    session: AuthSession | undefined,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const base: Record<string, string> = {
      Version: version,
      'User-Agent': userAgent,
      'Accept-Charset': 'UTF-8',
    };
    if (session) {
      base['Token'] = session.accessToken;
      const cookie = session.providerContext?.['wafCookie'];
      if (cookie) base['Cookie'] = cookie;
    }
    return { ...base, ...extra };
  }

  async function request(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number | string; message?: string; data?: unknown; setCookie?: string }> {
    try {
      const response = await requestWithTimeout(transport, url, {
        ...init,
        credentials: 'omit',
        redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError('SESSION_EXPIRED', '登录已失效，请重新登录');
      }
      if ([429, 451].includes(response.status)) {
        throw new ProviderError('UNSUPPORTED', '请求受到频率限制，请稍后再试');
      }
      if (response.status !== 200)
        throw new ProviderError('NETWORK', '七天学堂服务请求失败', response.status >= 500);
      const body = parse(envelopeSchema, await response.json(), '响应');
      if (Number(body.status) !== 200) throw businessError(body.status);
      return { ...body, setCookie: response.headers.get('set-cookie') ?? undefined };
    } catch (error) {
      throwIfAborted(init.signal);
      if (error instanceof ProviderError) throw error;
      // 不向调用方透出网络异常原文或响应内容。
      throw new ProviderError('NETWORK', '七天学堂请求失败或超时', true);
    }
  }

  function openData(data: unknown, sessionKey?: Uint8Array): unknown {
    const sealed = sealedSchema.safeParse(data);
    if (!sealed.success) return data;
    if (sealed.data.bn && sealed.data.content) {
      if (!sessionKey) throw new ProviderError('UNKNOWN', '缺少会话密钥');
      try {
        return JSON.parse(
          bytesToUtf8(
            gcm(sessionKey, base64ToBytes(sealed.data.bn)).decrypt(
              base64ToBytes(sealed.data.content),
            ),
          ),
        );
      } catch {
        throw new ProviderError('UNKNOWN', '七天学堂响应解密失败');
      }
    }
    if (sealed.data.isEncrypt && sealed.data.content) {
      // 平台用 AES-ECB/PKCS#7。noble 的 decrypt 自带该填充层，并在填充非法时抛错 —— 不要再手动去填充。
      try {
        return JSON.parse(
          bytesToUtf8(ecb(staticResponseKey).decrypt(base64ToBytes(sealed.data.content))),
        );
      } catch {
        throw new ProviderError('UNKNOWN', '七天学堂响应解密失败');
      }
    }
    return data;
  }

  /** 每次加密请求现场生成会话密钥：服务端按请求自带的 `bk` 解密，无需预先协商。 */
  function seal(params: Record<string, string>): {
    key: Uint8Array;
    headers: Record<string, string>;
  } {
    const key = random(32);
    const bk = bytesToBase64(rsaEncryptPkcs1(utf8ToBytes(bytesToBase64(key)), random));
    const paramString = toParamString(params);
    // 无业务参数时只带 bk（与官方客户端对 GetUserInfo 的行为一致）。
    if (!paramString) return { key, headers: { bk } };
    const nonce = random(12);
    const ciphertext = gcm(key, nonce).encrypt(utf8ToBytes(paramString));
    return {
      key,
      headers: { bk, bn: bytesToBase64(nonce), bp: bytesToBase64(ciphertext) },
    };
  }

  async function userInfo(session: AuthSession, options?: ProviderRequestOptions) {
    if (session.providerContext?.loginMethod === 'miniapp') {
      return parse(
        profileSchema,
        await publicPost(session, 'publicszoneui.service/UserService/info', {}, options),
        '学生信息',
      );
    }
    const sealed = seal({});
    const body = await request(host + 'userInfo/GetUserInfo', {
      method: 'GET',
      headers: headers(session, {
        ...sealed.headers,
        'Content-Type': 'application/json; charset=utf-8;',
      }),
      signal: options?.signal,
    });
    return parse(profileSchema, openData(body.data, sealed.key), '学生信息');
  }

  async function examPage(
    session: AuthSession,
    startIndex: number,
    rows: number,
    options?: ProviderRequestOptions,
  ) {
    const target = context(session);
    if (session.providerContext?.loginMethod === 'miniapp') {
      return parse(
        examPageSchema,
        await publicPost(
          session,
          'publicszoneui.service/ExamNService/ClaimExams',
          {
            startIndex: String(startIndex),
            rows: String(rows),
            schoolGuid: target.schoolGuid,
            grade: target.grade,
          },
          options,
        ),
        '考试列表',
      );
    }
    const query =
      `startIndex=${startIndex}&rows=${rows}` +
      `&schoolGuid=${encodeURIComponent(target.schoolGuid)}&grade=${encodeURIComponent(target.grade)}`;
    const body = await request(scoreHost + 'exam/getClaimExams?' + query, {
      method: 'GET',
      headers: headers(session, { 'Content-Type': 'application/json; charset=utf-8;' }),
      signal: options?.signal,
    });
    return parse(examPageSchema, openData(body.data), '考试列表');
  }

  async function encryptedPost(
    session: AuthSession,
    route: string,
    params: Record<string, string>,
    options?: ProviderRequestOptions,
  ) {
    if (session.providerContext?.loginMethod === 'miniapp') {
      return publicPost(
        session,
        route.replace(/^Question\//, 'publicszoneui.service/QuestionNService/'),
        params,
        options,
      );
    }
    const sealed = seal(params);
    const body = await request(scoreHost + route, {
      method: 'POST',
      headers: headers(session, {
        ...sealed.headers,
        'Content-Type': 'application/json; charset=UTF-8',
      }),
      body: '{}',
      signal: options?.signal,
    });
    return openData(body.data, sealed.key);
  }

  async function formPost(
    session: AuthSession,
    route: string,
    params: Record<string, string>,
    options?: ProviderRequestOptions,
  ) {
    if (session.providerContext?.loginMethod === 'miniapp') {
      const routes: Record<string, string> = {
        'exam/SetView': 'SetView',
        'exam/UnClaimImg': 'UnClaimImg',
        'exam/claimExam': 'ClaimExam',
      };
      if (!routes[route]) throw new ProviderError('UNSUPPORTED', '小程序接口不支持该操作');
      return publicPost(
        session,
        'publicszoneui.service/ExamService/' + routes[route],
        params,
        options,
      );
    }
    const body = await request(scoreHost + route, {
      method: 'POST',
      headers: headers(session, {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8;',
      }),
      body: new URLSearchParams(params).toString(),
      signal: options?.signal,
    });
    return openData(body.data);
  }

  /**
   * 小程序接口面：token 与版本号放进请求参数，不发送 `Token` 头（与官方小程序同形；实测服务端不校验）。
   * 响应仍可能使用平台静态密钥加密，沿用 `openData` 解密；错误语义与 App 接口面一致。
   */
  async function publicPost(
    session: AuthSession,
    route: string,
    params: Record<string, string>,
    options?: ProviderRequestOptions,
  ) {
    const publicHeaders: Record<string, string> = {
      Version: version,
      'User-Agent': userAgent,
      'Accept-Charset': 'UTF-8',
    };
    const cookie = session.providerContext?.['wafCookie'];
    if (cookie) publicHeaders['Cookie'] = cookie;
    const body = await request(publicHost + route, {
      method: 'POST',
      headers: {
        ...publicHeaders,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8;',
      },
      body: new URLSearchParams({ ...params, token: session.accessToken, version }).toString(),
      signal: options?.signal,
    });
    return openData(body.data);
  }

  /** 按科目定位考试成绩缓存里的科目行；缺考与不存在返回 undefined。 */
  function locateSubject(result: ExamResult, subjectId: string) {
    const subject = result.subjects.find(
      (item) => item.id === subjectId || item.subject === subjectId,
    );
    return subject && subject.status !== 'absent' ? subject : undefined;
  }

  /** 附加报告缺失不阻断基础成绩；失效会话和取消操作仍交给统一错误路径。 */
  async function optionalReport<T>(
    task: () => Promise<T>,
    label: string,
    options?: ProviderRequestOptions,
  ): Promise<{ data?: T; notice?: string }> {
    try {
      return { data: await task() };
    } catch (error) {
      throwIfAborted(options?.signal);
      if (!(error instanceof ProviderError) || error.code === 'SESSION_EXPIRED') throw error;
      return {
        notice:
          error.code === 'NOT_FOUND' || error.code === 'UNSUPPORTED'
            ? `${label}：平台暂未提供可用数据。`
            : `${label}暂时加载失败，可稍后重新进入查看。`,
      };
    }
  }

  /** 列表接口不带考试名，故按页回查，避免伪造名称。 */
  async function findExam(
    session: AuthSession,
    examId: string,
    options?: ProviderRequestOptions,
    rows = 8,
    maxPages = 100,
  ) {
    let offset = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const data = await examPage(session, offset, rows, options);
      const found = data.list.find((item) => item.examGuid === examId);
      if (found) return found;
      if (data.list.length < rows) break;
      const nextOffset = data.startIndex ?? offset + rows;
      if (nextOffset <= offset) break;
      offset = nextOffset;
    }
    throw new ProviderError('NOT_FOUND', '在最近的考试中没有找到该考试');
  }

  /**
   * 答题卡按科目（作答记录）取：实测需要 responseGuid + schoolRuCode；schoolRuCode 缺失会静默返回 0 条。
   * `watermark` 选择官方客户端的两套渲染：false = 干净扫描件；true = 图片上标注各题得分的版本。
   */
  async function answerCardSheets(
    session: AuthSession,
    examId: string,
    subjectId: string,
    watermark: boolean,
    options?: ProviderRequestOptions,
  ): Promise<AnswerSheet[]> {
    assertSession(session);
    if (!subjectId) return [];
    const target = context(session);
    const params = { examGuid: examId, schoolGuid: target.schoolGuid, grade: target.grade };
    const subjects = parse(
      subjectsSchema,
      await encryptedPost(session, 'Question/Subjects', params, options),
      '科目列表',
    );
    const sheets: AnswerSheet[] = [];
    for (const subject of subjects.list) {
      if (subject.km !== subjectId) continue;
      if (
        subject.km === '总分' ||
        subject.code === -1 ||
        subject.code === -2 ||
        !subject.responseGuid
      )
        continue;
      const card = parse(
        answerCardSchema,
        await encryptedPost(
          session,
          'Question/AnswerCardUrl',
          {
            ...params,
            responseGuid: subject.responseGuid,
            isWatermark: watermark ? 'true' : 'false',
            schoolRuCode: target.ruCode,
          },
          options,
        ),
        '答题卡',
      );
      for (const url of card.answerUrls ?? []) {
        sheets.push({
          subject: subject.km,
          url,
          watermarked: watermark || card.isWatermark === true,
        });
      }
    }
    return sheets;
  }

  return {
    metadata: {
      id: providerId,
      name: '七天学堂',
      remark: '七天网络',
      description: '支持官方APP登录与小程序登录；使用账号密码直连官方服务。',
      officialDomain: host,
    },
    // 实测：平台只提供「等级位置」，且非会员被门控拦截（charge.ShowPosition=false）。
    capabilities: {
      profile: true,
      exams: true,
      results: true,
      ranking: false,
      subjectDetails: true,
      answerSheets: true,
    },
    passwordLoginMethods: [
      { id: 'app', label: '官方APP登录' },
      { id: 'miniapp', label: '小程序登录' },
    ],
    async authenticate(account, password) {
      return this.authenticateWithMethod!(account, password, 'app');
    },
    async authenticateWithMethod(account, password, method) {
      if (method !== 'app' && method !== 'miniapp')
        throw new ProviderError('UNSUPPORTED', '不支持该登录方式');
      if (!account.trim() || !password)
        throw new ProviderError('INVALID_CREDENTIALS', '请输入账号和密码');
      const miniapp = method === 'miniapp';
      const body = miniapp
        ? new URLSearchParams({
            userCode: account.trim(),
            userPass: password,
            openId: await septnetOpenId(account),
            unionid: '',
            token: '',
            version,
          }).toString()
        : `userCode=${encodeURIComponent(account.trim())}` +
          `&password=${encodeURIComponent(bytesToBase64(utf8ToBytes(password + passwordSuffix)))}`;
      const login = await request(
        miniapp ? publicHost + 'publicszoneui.service/XCXService/Login' : host + 'login',
        {
          method: 'POST',
          headers: headers(undefined, {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8;',
          }),
          body,
        },
      ).catch((error: unknown) => {
        // 实测：账号/口令不对时平台返回 403（非 401），对登录而言这是凭据问题而非会话过期。
        if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') {
          throw new ProviderError('INVALID_CREDENTIALS', '账号或密码不正确');
        }
        throw error;
      });
      const data = parse(loginSchema, miniapp ? openData(login.data) : login.data, '登录结果');
      // 登录响应下发的 WAF 会话 cookie（aliyungf_tc），此后每个请求都要回传。
      const wafCookie = /(?:^|,\s*)(aliyungf_tc=[^;,\s]+)/.exec(login.setCookie ?? '')?.[1];
      const session: AuthSession = {
        providerId,
        accountId: account.trim(),
        accessToken: data.token,
        providerContext: {
          ...(miniapp ? { loginMethod: 'miniapp' } : {}),
          ...(wafCookie ? { wafCookie } : {}),
        },
      };
      // 官方客户端登录后会做一次密钥协商；实测加密接口并不依赖它，失败可忽略。
      try {
        if (!miniapp) {
          const sealed = seal({});
          await request(host + 'user', {
            method: 'POST',
            headers: headers(session, {
              ...sealed.headers,
              'Content-Type': 'application/json; charset=UTF-8',
            }),
            body: '{}',
          });
        }
      } catch {
        /* 协商失败不影响后续请求 */
      }
      const profile = await userInfo(session);
      const schoolGuid = profile.schoolGuid;
      const grade = (profile.currentGrade ?? profile.grade ?? '').toLowerCase();
      if (!schoolGuid || !grade)
        throw new ProviderError('UNSUPPORTED', '该账号未绑定学校信息，请在官方 App 检查');
      session.providerContext = {
        ...(miniapp ? { loginMethod: 'miniapp' } : {}),
        schoolGuid,
        grade,
        ...(profile.studentName ? { studentName: profile.studentName } : {}),
        ...(profile.ruCode ? { ruCode: profile.ruCode } : {}),
        ...(wafCookie ? { wafCookie } : {}),
      };
      return session;
    },
    async getProfile(session, options?: ProviderRequestOptions) {
      assertSession(session);
      const profile = await userInfo(session, options);
      return {
        id: profile.studentGuid ?? profile.userGuid ?? session.accountId,
        displayName: profile.nickName || profile.studentName || '未命名',
        schoolName: profile.schoolName || undefined,
        grade: profile.currentGrade || profile.grade || undefined,
      };
    },
    async getExamList(session, page = {}, options?: ProviderRequestOptions) {
      const start = page.offset ?? 0;
      if (!Number.isSafeInteger(start) || start < 0)
        throw new ProviderError('UNKNOWN', '分页参数无效');
      const data = await examPage(session, start, 8, options);
      const target = context(session);
      return Promise.all(
        data.list.map(async (exam) => {
          // 列表不返回联考属性，只为已可查看考试补取官方科目信息；失败时不猜测校考。
          const metadata =
            exam.authView === 0
              ? await optionalReport(
                  async () =>
                    parse(
                      subjectsSchema,
                      await encryptedPost(
                        session,
                        'Question/Subjects',
                        {
                          examGuid: exam.examGuid,
                          schoolGuid: target.schoolGuid,
                          grade: target.grade,
                        },
                        options,
                      ),
                      '考试属性',
                    ).exam_info,
                  '考试属性',
                  options,
                )
              : undefined;
          return {
            id: exam.examGuid,
            name: exam.examName,
            date: exam.time,
            category: (exam.type ?? '').trim() || '其它',
            hasResult: exam.authView === 0,
            ...(metadata?.data?.isUnion !== undefined ? { isUnion: metadata.data.isUnion } : {}),
          };
        }),
      );
    },
    async loadExam(session, examId, options?: ProviderRequestOptions) {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(examId))
        throw new ProviderError('NOT_FOUND', '考试标识无效');
      await formPost(session, 'exam/SetView', { examGuid: examId }, options);
    },
    async getUnclaimedExams(session, options?: ProviderRequestOptions): Promise<UnclaimedExam[]> {
      const target = context(session);
      const profile = target.studentName ? undefined : await userInfo(session, options);
      const studentName = target.studentName ?? profile?.studentName;
      if (!studentName) throw new ProviderError('UNSUPPORTED', '缺少学生姓名，请重新登录');
      const grade = profile?.currentGrade ?? target.grade;
      const query = new URLSearchParams({ studentName, schoolGuid: target.schoolGuid, grade });
      const data =
        session.providerContext?.loginMethod === 'miniapp'
          ? await publicPost(
              session,
              'publicszoneui.service/ExamService/UnclaimExams',
              Object.fromEntries(query),
              options,
            )
          : openData(
              (
                await request(scoreHost + `exam/getUnClaimExams?${query.toString()}`, {
                  method: 'GET',
                  headers: headers(session),
                  signal: options?.signal,
                })
              ).data,
            );
      const groups = parse(unclaimedPageSchema, data, '待认领考试');
      return groups.flatMap((group) =>
        group.list.map((item) => ({
          id: item.examGuid,
          name: item.examName,
          date: item.time,
          studentCodes: item.studentCodeList,
        })),
      );
    },
    async getClaimCandidates(
      session,
      examId,
      studentCodes,
      options?: ProviderRequestOptions,
    ): Promise<ClaimCandidate[]> {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(examId) || !studentCodes.length) return [];
      const data = await formPost(
        session,
        'exam/UnClaimImg',
        { examGuid: examId, studentCodes: JSON.stringify(studentCodes) },
        options,
      );
      return parse(claimCandidateSchema, data, '认领候选试卷');
    },
    async claimExam(session, examId, studentCode, options?: ProviderRequestOptions): Promise<void> {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(examId) || !studentCode)
        throw new ProviderError('NOT_FOUND', '认领参数无效');
      await formPost(session, 'exam/claimExam', { examGuid: examId, studentCode }, options);
    },
    async getExamResult(session, examId, options?: ProviderRequestOptions) {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(examId))
        throw new ProviderError('NOT_FOUND', '考试标识无效');
      const exam = await findExam(session, examId, options);
      if (exam.authView !== undefined && exam.authView >= 1) {
        throw new ProviderError('NOT_FOUND', '该考试需先在官方 App 载入或认领后才能查看');
      }
      const target = context(session);
      const params = { examGuid: examId, schoolGuid: target.schoolGuid, grade: target.grade };
      const config = parse(
        configSchema,
        await encryptedPost(session, 'Question/Config', params, options),
        '考试配置',
      );
      if (config.config?.CloseCF === true)
        throw new ProviderError('NOT_FOUND', '本场考试主办方已关闭');
      const subjects = parse(
        subjectsSchema,
        await encryptedPost(session, 'Question/Subjects', params, options),
        '科目列表',
      );
      if (!config.charge) throw new ProviderError('UNKNOWN', '七天学堂考试配置缺少权限信息');
      // code === -1 表示该科目不可用；总分行的 code 是 -2，属正常行。
      const rows = subjects.list.filter((item) => item.code !== -1);
      const scoreable = rows.filter((item) => item.km !== '总分' && item.code !== -2);
      const merged = new Map<string, z.infer<typeof reportRowSchema>>();
      let info: z.infer<typeof reportSchema>['km_info'];
      // 实测：`km=总分` 那一次返回**全部行**（科目行 + 总分行），而 `km=<科目>` 的 km_list 为空，
      // 因此以「总分」为主调用；仅对未被覆盖的科目做兜底补取（补取也可能为空，属正常）。
      const collect = (report: z.infer<typeof reportSchema>) => {
        info = info ?? report.km_info;
        for (const row of report.km_list ?? []) if (!merged.has(row.km)) merged.set(row.km, row);
      };
      collect(
        parse(
          reportSchema,
          await encryptedPost(
            session,
            'Question/ScoreReport',
            {
              ...params,
              km: '总分',
            },
            options,
          ),
          '成绩明细',
        ),
      );
      // 兜底补取彼此独立且 collect 是同步归并（科目名各不相同），并发执行缩短串行往返等待。
      const missing = scoreable.filter((subject) => !merged.has(subject.km));
      await Promise.all(
        missing.map((subject) =>
          encryptedPost(
            session,
            'Question/ScoreReport',
            {
              ...params,
              km: subject.km,
            },
            options,
          ).then((data) => collect(parse(reportSchema, data, '成绩明细'))),
        ),
      );
      const total = merged.get('总分') ?? [...merged.values()].find((row) => row.kmTag === -2);
      const rawTotalScore = numericScore(total?.score ?? info?.score);
      const scaledTotalScore = assignedScore(total);
      const totalScore = scaledTotalScore ?? rawTotalScore;
      const maxTotalScore =
        numericScore(scaledTotalScore !== undefined ? total?.fuFullScore : undefined) ??
        numericScore(total?.fullScore ?? info?.fullScore);
      const absentSubjects = new Set(
        subjects.list.filter((item) => item.codeDesc === '缺考科目').map((item) => item.km),
      );
      // 缺考科目即便没有成绩行，也保留其明确状态供界面展示。
      for (const subject of subjects.list) {
        if (absentSubjects.has(subject.km) && !merged.has(subject.km))
          merged.set(subject.km, { km: subject.km, score: '缺考' });
      }
      const published = subjects.exam_info?.queryTime?.replace(/\//g, '-');
      // 考生人数是字符串（如 "512"），复用保守解析。
      const participantCount = numericScore(subjects.exam_info?.studentCount);
      // 先保留 Subjects 内嵌作文数据；缺失时在科目详情按需补取 ThScoreInfo。
      const essayBySubject = new Map(
        subjects.list
          .filter((item) => item.ai_essay_report?.essayThInfo)
          .map((item) => [item.km, item.ai_essay_report!.essayThInfo!]),
      );
      const totalGrade = (total?.grade ?? info?.grade ?? '').trim().toUpperCase();
      return {
        examId,
        examName: exam.examName,
        isUnion: subjects.exam_info?.isUnion,
        grade: totalGrade && totalGrade !== '-' ? totalGrade : undefined,
        gradePercentile: gradePercentileText(totalGrade),
        subjects: [...merged.values()]
          .filter((row) => row.km !== '总分' && row.kmTag !== -2)
          .map((row) => {
            const absent = absentSubjects.has(row.km) || row.score === '缺考';
            const rawScore = absent ? undefined : numericScore(row.score);
            const scaledScore = absent ? undefined : assignedScore(row);
            const essay = essayBySubject.get(row.km);
            const essayAvg = numericScore(essay?.avg);
            const essayMax = numericScore(essay?.max);
            const context: Record<string, string> = {};
            const subject = subjects.list.find((item) => item.km === row.km);
            if (!absent) {
              if (subject?.responseGuid) context.responseGuid = subject.responseGuid;
              if (subject?.srcKm) context.srcKm = subject.srcKm;
              if (exam.ruleHash) context.ruleHash = exam.ruleHash;
              // 考试级发布类型：小程序接口面的作文接口要求携带，与 ruleHash 同样按考试级字段处理。
              if (subjects.exam_info?.examPublishType !== undefined)
                context.examPublishType = String(subjects.exam_info.examPublishType);
              // 考试性质标签：旧版科目统计接口需要 examType。
              if (exam.type) context.examType = exam.type;
              if (row.rating?.trim()) context.rating = row.rating.trim();
              if (
                (subject?.ai_essay_report && Object.keys(subject.ai_essay_report).length) ||
                /语文|英语/.test(row.km)
              )
                context.hasEssayInfo = 'true';
              for (const field of [
                'th',
                'score',
                'full',
                'avg',
                'max',
                'diff',
                'highCount',
              ] as const) {
                if (essay?.[field] !== undefined) context[`essay_${field}`] = essay[field];
              }
            }
            const gradeCode = (row.grade ?? '').trim().toUpperCase();
            const gradePercentile = absent ? undefined : gradePercentileText(gradeCode);
            if (gradePercentile !== undefined) context.gradePercentile = gradePercentile;
            if (essayAvg !== undefined) context.essayAvg = String(essayAvg);
            if (essayMax !== undefined) context.essayMax = String(essayMax);
            if (scaledScore !== undefined) {
              context.scaledScore = String(scaledScore);
              if (rawScore !== undefined) context.originalScore = String(rawScore);
            }
            return {
              subject: row.km,
              score: scaledScore ?? rawScore,
              maxScore:
                numericScore(scaledScore !== undefined ? row.fuFullScore : undefined) ??
                numericScore(row.fullScore),
              grade: absent
                ? undefined
                : gradePercentile !== undefined
                  ? gradeCode
                  : row.rating || row.grade || undefined,
              ...(absent ? { status: 'absent' as const } : {}),
              ...(Object.keys(context).length ? { providerContext: context } : {}),
            };
          }),
        totalScore,
        maxTotalScore: maxTotalScore ?? 0,
        ...(scaledTotalScore !== undefined && rawTotalScore !== undefined
          ? { originalTotalScore: rawTotalScore }
          : {}),
        ...(participantCount !== undefined ? { participantCount } : {}),
        // 联考的等第百分比是校内排名比例，容易被误读为联考范围；顶部给出可关闭说明。
        ...(subjects.exam_info?.isUnion === true
          ? {
              notice: {
                id: 'septnet-union-grade-scope',
                text: '等第及对应的百分比值所表示的是在学校内的排名比例，并非联考的排名比例。',
              },
            }
          : {}),
        ...(scaledTotalScore !== undefined
          ? { originalMaxTotalScore: numericScore(total?.fullScore ?? info?.fullScore) }
          : {}),
        // 平台不提供名次（只有等级位置，且非会员被拦截）：保持 undefined。
        ranking: undefined,
        publishedAt: published,
      };
    },
    async getSubjectDetail(
      session,
      examId,
      subjectId,
      cachedResult,
      options?: ProviderRequestOptions,
    ) {
      const result =
        cachedResult?.examId === examId
          ? cachedResult
          : await this.getExamResult(session, examId, options);
      const subject = result.subjects.find(
        (item) => item.id === subjectId || item.subject === subjectId,
      );
      if (!subject || subject.status === 'absent')
        throw new ProviderError('NOT_FOUND', '该科目不可用或已标记缺考');
      const target = context(session);
      const ctx = subject.providerContext ?? {};
      const params = {
        examGuid: examId,
        schoolGuid: target.schoolGuid,
        grade: target.grade,
        schoolRuCode: target.ruCode,
        km: subject.subject,
        srcKm: ctx.srcKm ?? subject.subject,
      };
      const reportSections: ReportSection[] = [];
      const notices: string[] = [];
      const embeddedEssay = Object.fromEntries(
        ['th', 'score', 'full', 'avg', 'max', 'diff', 'highCount'].flatMap((field) =>
          ctx[`essay_${field}`] !== undefined ? [[field, ctx[`essay_${field}`]]] : [],
        ),
      );
      const [essay, distribution] = await Promise.all([
        ctx.hasEssayInfo &&
        ctx.ruleHash &&
        !['score', 'full', 'avg', 'max', 'highCount'].every(
          (field) => numericScore(embeddedEssay[field]) !== undefined,
        )
          ? optionalReport(
              async () =>
                parse(
                  essayResponseSchema,
                  await encryptedPost(
                    session,
                    'Question/ThScoreInfo',
                    { ...params, ruleHash: ctx.ruleHash },
                    options,
                  ),
                  '作文统计',
                ).essayThInfo,
              '作文统计',
              options,
            )
          : Promise.resolve({ data: undefined, notice: undefined }),
        ctx.ruleHash && ctx.responseGuid
          ? optionalReport(
              async () =>
                parse(
                  distributionSchema,
                  await encryptedPost(
                    session,
                    'Question/SubjectTHDistri',
                    { ...params, ruleHash: ctx.ruleHash, responseGuid: ctx.responseGuid },
                    options,
                  ),
                  '题目分布',
                ),
              '题目分布',
              options,
            )
          : Promise.resolve({ data: undefined, notice: undefined }),
      ]);
      const essayReport = essaySection({ ...embeddedEssay, ...essay.data });
      if (essayReport) reportSections.push(essayReport);
      else if (essay.notice) notices.push(essay.notice);
      const distributionReport = distribution.data && distributionSection(distribution.data);
      if (distributionReport) reportSections.push(distributionReport);
      else if (distribution.notice) notices.push(distribution.notice);
      if (notices.length)
        reportSections.push({ id: 'septnet-extra-status', title: '附加信息', notes: notices });
      // 作文统计统一放入报告卡片，避免旧页头的 avg/max 文案重复显示。
      const providerContext = Object.fromEntries(
        Object.entries(ctx).filter(([key]) => key !== 'essayAvg' && key !== 'essayMax'),
      );
      return {
        subjectId,
        subject: subject.subject,
        score: subject.score,
        maxScore: subject.maxScore,
        grade: subject.grade,
        providerContext,
        reportSections,
      };
    },
    // 小程序接口面（szone-public）的原卷：按科目返回原卷扫描图，地址为短期签名直链，界面过期后重取。
    async getPaperImages(
      session,
      examId,
      subjectId,
      cachedResult,
      options?: ProviderRequestOptions,
    ): Promise<AnswerSheet[]> {
      const result =
        cachedResult?.examId === examId
          ? cachedResult
          : await this.getExamResult(session, examId, options);
      const subject = locateSubject(result, subjectId);
      if (!subject) throw new ProviderError('NOT_FOUND', '该科目不可用或已标记缺考');
      const target = context(session);
      const ctx = subject.providerContext ?? {};
      const data = parse(
        paperSchema,
        await publicPost(
          session,
          'publicszoneui.service/QuestionNService/Paper',
          {
            examGuid: examId,
            schoolGuid: target.schoolGuid,
            grade: target.grade,
            schoolRuCode: target.ruCode,
            km: subject.subject,
            srcKm: ctx.srcKm ?? subject.subject,
          },
          options,
        ),
        '试卷原卷',
      );
      // 原卷是空白试卷扫描件，不含个人作答与得分标注。
      return data
        .flatMap((paper) => paper.imgUrls ?? [])
        .map((url) => ({ subject: subject.subject, subjectId, url, watermarked: false }));
    },
    /**
     * 小程序接口面的作文数据：题干全文 + 本人作答切图（作答图与答题卡同源，标记为含水印）。
     * 统计卡片沿用 `Question/ThScoreInfo` 的既有实现，这里只补题干与图片；缺参数时安静降级。
     */
    async getEssayDetail(
      session,
      examId,
      subjectId,
      cachedResult,
      options?: ProviderRequestOptions,
    ): Promise<EssayDetail> {
      const empty: EssayDetail = { answerSheets: [] };
      const result =
        cachedResult?.examId === examId
          ? cachedResult
          : await this.getExamResult(session, examId, options);
      const subject = locateSubject(result, subjectId);
      if (!subject) return empty;
      const ctx = subject.providerContext ?? {};
      if (ctx.hasEssayInfo !== 'true') return empty;
      const target = context(session);
      const srcKm = ctx.srcKm ?? subject.subject;
      const base = {
        examGuid: examId,
        schoolGuid: target.schoolGuid,
        grade: target.grade,
        schoolRuCode: target.ruCode,
        km: subject.subject,
        srcKm,
        subject: subject.subject,
        srcSubject: srcKm,
        examPublishType: ctx.examPublishType ?? '',
      };
      const [report, stem] = await Promise.all([
        ctx.responseGuid && ctx.examPublishType !== undefined
          ? optionalReport(
              async () =>
                parse(
                  essayReportSchema,
                  await publicPost(
                    session,
                    'publicszoneui.service/QuestionNService/AIEssayReport',
                    { ...base, responseGuid: ctx.responseGuid, asiResponse: ctx.responseGuid },
                    options,
                  ),
                  '作文作答',
                ),
              '作文作答',
              options,
            )
          : Promise.resolve({ data: undefined, notice: undefined }),
        // 实测：题干接口同样要求 responseGuid（缺它返回 400）。
        ctx.essay_th && ctx.responseGuid
          ? optionalReport(
              async () =>
                parse(
                  essayStemSchema,
                  await publicPost(
                    session,
                    'publicszoneui.service/QuestionNService/EssayQuestionStem',
                    { ...base, th: ctx.essay_th!, type: '1', responseGuid: ctx.responseGuid },
                    options,
                  ),
                  '作文题干',
                ),
              '作文题干',
              options,
            )
          : Promise.resolve({ data: undefined, notice: undefined }),
      ]);
      const prompt = stem.data?.questionStemTxt?.trim();
      // 作答切图缺失时退回平台下发的 PDF 分页图，两者都来自同一份作答扫描。
      const images = report.data?.myAnswers?.length
        ? report.data.myAnswers
        : (report.data?.pdfImgs ?? []);
      return {
        ...(prompt ? { prompt } : {}),
        answerSheets: images.map((url) => ({
          subject: subject.subject,
          subjectId,
          url,
          watermarked: true,
        })),
      };
    },
    /**
     * 调试用途：把平台未与官方 UI 对照语义的原始字段交给调试模式展示（如 v1 `SubjectGrade` 的 `report.total`）。
     * 任一环节不可用即返回空数组；不把 studentCode 等中间凭据透出给界面。
     */
    /**
     * 科目级统计：校内参加本科目考试的考生人数（平台旧版接口的 `report.total`，已由项目负责人确认语义）。
     * 取数需要先换考号，且只对本人有权查看的科目有效；任一环节不可用即返回空数组，不阻断科目详情。
     */
    async getSubjectStatistics(
      session,
      examId,
      subjectId,
      cachedResult,
      options?: ProviderRequestOptions,
    ): Promise<SubjectStatistic[]> {
      const result =
        cachedResult?.examId === examId
          ? cachedResult
          : await this.getExamResult(session, examId, options);
      const subject = locateSubject(result, subjectId);
      const target = context(session);
      const ctx = subject?.providerContext ?? {};
      if (!subject || !ctx.examType || !target.ruCode) return [];
      const params = {
        examGuid: examId,
        schoolGuid: target.schoolGuid,
        grade: target.grade,
        schoolRuCode: target.ruCode,
        ruCode: target.ruCode,
        examType: ctx.examType,
        examSchoolGuid: target.schoolGuid,
        subject: subject.subject,
        subjectCount: String(result.subjects.length),
      };
      try {
        const redirect = parse(
          studentCodeSchema,
          await publicPost(
            session,
            'publicszoneui.service/AIErrorBookService/Redirect',
            {
              ruCode: target.ruCode,
              examGuid: examId,
              studentCode: '',
              schoolGuid: target.schoolGuid,
              examSchoolGuid: target.schoolGuid,
              grade: target.grade,
              from: '1',
            },
            options,
          ),
          '科目统计',
        );
        if (!redirect.studentCode) return [];
        const grade = parse(
          subjectGradeSchema,
          await publicPost(
            session,
            'publicszoneui.service/QuestionService/SubjectGrade',
            { ...params, studentCode: redirect.studentCode },
            options,
          ),
          '科目统计',
        );
        const total = grade.report?.total;
        // 0 或负数不是有效人数，视为未提供。
        if (total === undefined || total <= 0) return [];
        const statistics: SubjectStatistic[] = [{ scope: '学校参考', participantCount: total }];
        // 预估排名 = 参考人数 × 等第比例带（从高到低），上下界向上取整；未知等第不推算。
        const band = gradeBand(subject.grade);
        if (band) {
          const lower = Math.max(1, Math.ceil((total * band.min) / 100));
          const upper = Math.min(total, Math.ceil((total * band.max) / 100));
          statistics.push({
            scope: '学校',
            rank: lower,
            rankMax: Math.max(lower, upper),
            estimate: true,
          });
        }
        return statistics;
      } catch (error) {
        throwIfAborted(options?.signal);
        if (error instanceof ProviderError && error.code === 'SESSION_EXPIRED') throw error;
        return [];
      }
    },
    async getAnswerSheets(
      session,
      examId,
      subjectId,
      _cachedResult,
      options?: ProviderRequestOptions,
    ) {
      return answerCardSheets(session, examId, subjectId, false, options);
    },
    // 官方客户端行为：`AnswerCardUrl` 以 isWatermark=true 再取一次，得到图片上标注了各题得分的版本；
    // 与 isWatermark=false 的干净扫描件是两套独立 URL，互不影响。
    async getWatermarkedAnswerSheets(
      session,
      examId,
      subjectId,
      _cachedResult,
      options?: ProviderRequestOptions,
    ) {
      return answerCardSheets(session, examId, subjectId, true, options);
    },
    async logout(session) {
      revoked.add(session);
    },
  };
}

export const septnetProvider = createSeptnetProvider();
