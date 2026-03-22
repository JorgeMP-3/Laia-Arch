export const LAIA_ARCH_CLI_ENV_VAR = "LAIA_ARCH_CLI";
export const LAIA_ARCH_CLI_ENV_VALUE = "1";

export function markOpenClawExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [LAIA_ARCH_CLI_ENV_VAR]: LAIA_ARCH_CLI_ENV_VALUE,
  };
}

export function ensureOpenClawExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[LAIA_ARCH_CLI_ENV_VAR] = LAIA_ARCH_CLI_ENV_VALUE;
  return env;
}
