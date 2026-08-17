export const EXIT_CODES = Object.freeze({
  OK: 0,
  AUTH_EXPIRED: 2,
  CONFIG: 3,
  NOTION: 4,
  DATA: 5,
});

export class AppError extends Error {
  constructor(message, { code = "APP_ERROR", exitCode = EXIT_CODES.DATA, cause } = {}) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class AuthExpiredError extends AppError {
  constructor(message = "Coremail 鉴权已失效，请在本机更新 Cookie 后重试。", options = {}) {
    super(message, { ...options, code: "AUTH_EXPIRED", exitCode: EXIT_CODES.AUTH_EXPIRED });
    this.name = "AuthExpiredError";
  }
}

export class ConfigError extends AppError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "CONFIG_ERROR", exitCode: EXIT_CODES.CONFIG });
    this.name = "ConfigError";
  }
}

export class NotionError extends AppError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "NOTION_ERROR", exitCode: EXIT_CODES.NOTION });
    this.name = "NotionError";
  }
}
