const SAFE_MESSAGES = {
  CONFIG_MISSING_SIGN: "缺少 Zeus Token 签名本地配置。",
  CONFIG_INVALID: "Zeus 本地配置无效。",
  AUTH_FAILED: "Zeus 身份认证失败。",
  API_UNAVAILABLE: "Zeus 接口当前不可用。",
  API_REJECTED: "Zeus 拒绝了当前请求。",
  SUBMISSION_UNCERTAIN: "提交结果不确定，请在“我的申请”中核对，禁止自动重试。",
  MISSING_FIELD_SYSTEM: "缺少领域/系统。",
  MISSING_DESCRIPTION: "缺少申请原因。",
  DESCRIPTION_TOO_LONG: "申请原因不能超过 255 个字符。",
  MISSING_PERMISSIONS: "至少需要一个资源权限申请。",
  MISSING_ACCOUNTS: "每个资源至少需要一个申请人权限配置。",
  SYSTEM_NOT_FOUND: "领域/系统不在 Zeus 候选列表中。",
  AMBIGUOUS_SYSTEM: "领域/系统匹配到多个候选，请明确选择。",
  USER_NOT_FOUND: "申请人不在 Zeus 用户列表中。",
  AMBIGUOUS_USER: "申请人姓名存在多个候选，请按工号选择。",
  CURRENT_USER_NOT_FOUND: "无法确认当前用户工号，请显式提供工号。",
  ASSET_NOT_FOUND: "资源不在所选系统的 Zeus 资源列表中。",
  AMBIGUOUS_ASSET: "资源匹配到多个候选，请明确选择。",
  PERMISSION_TYPE_NOT_ALLOWED: "权限类别不在该资源和申请人的可选范围内。",
  AMBIGUOUS_PERMISSION_TYPE: "权限类别匹配到多个候选，请明确选择。",
  DURATION_NOT_ALLOWED: "期限不在该申请人的可选范围内。",
  AMBIGUOUS_DURATION: "期限匹配到多个候选，请明确选择。",
  DUPLICATE_PERMISSION: "同一资源下存在重复的申请人和权限类别。",
  MUTUALLY_EXCLUSIVE_PERMISSION: "同一资源和申请人不能同时申请互斥权限类别。",
  CONFIRMATION_REQUIRED: "仅精确回复“确认提交”才允许正式提单。",
  CONFIRMATION_NOT_FOUND: "确认信息不存在或已失效，请重新核对提单。",
  CONFIRMATION_EXPIRED: "确认信息已过期，请重新核对提单。",
  CONFIRMATION_USED: "该确认信息已使用，不能重复提交。",
  CONFIRMATION_CHANGED: "提单内容已变化，请重新核对并确认。"
};

export class WorkflowError extends Error {
  constructor(code, details = undefined, cause = undefined) {
    super(SAFE_MESSAGES[code] ?? "服务器权限申请处理失败。");
    this.name = "WorkflowError";
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export function asSafeError(error) {
  return error instanceof WorkflowError ? error : new WorkflowError("API_UNAVAILABLE", undefined, error);
}

export function safeErrorJson(error) {
  const safe = asSafeError(error);
  return {
    ok: false,
    error: {
      code: safe.code,
      message: safe.message,
      ...(safe.details === undefined ? {} : { details: safe.details })
    }
  };
}

