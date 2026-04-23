// Purpose: Centralize oracle jobs-directory precedence and mutable in-process override state.
// Responsibilities: Expose default/env constants, allow session-scoped configured overrides, and resolve the effective writable jobs directory.
// Scope: Filesystem path resolution only; job lifecycle persistence remains in jobs/runtime/worker modules.
// Usage: Imported by config-aware extension code to sync project config, and by jobs/runtime modules to read the active jobs directory.
// Invariants/Assumptions: PI_ORACLE_JOBS_DIR has highest precedence; configured overrides are absolute normalized paths set by extension code after config load.

export const DEFAULT_ORACLE_JOBS_DIR = "/tmp";
export const ORACLE_JOBS_DIR_ENV = "PI_ORACLE_JOBS_DIR";

let configuredOracleJobsDir: string | undefined;

export function setConfiguredOracleJobsDir(path: string | undefined): void {
  configuredOracleJobsDir = path?.trim() || undefined;
}

export function getConfiguredOracleJobsDir(): string | undefined {
  return configuredOracleJobsDir;
}

export function getEffectiveOracleJobsDir(): string {
  return process.env[ORACLE_JOBS_DIR_ENV]?.trim() || configuredOracleJobsDir || DEFAULT_ORACLE_JOBS_DIR;
}
