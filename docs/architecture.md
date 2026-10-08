# 架构

MagicMirror 是直接由 Android 客户端访问阅卷平台官方服务的 Expo 应用，不包含中转成绩或认证信息的业务后端。UI 通过业务查询层调用 `ScoreProvider`，Provider 负责平台差异和统一模型转换。TanStack Query 管理考试和成绩等远程数据，Zustand 管理当前 Provider、账号和主题，Expo SecureStore 保存 Session。
