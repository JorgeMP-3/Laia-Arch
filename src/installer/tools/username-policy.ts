const INSTALLER_USERNAME_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/;

export const INSTALLER_USERNAME_EXAMPLE = "usuario1 o ana.garcia";
export const INSTALLER_USERNAME_DESCRIPTION = `Usuario en minúsculas, por ejemplo: ${INSTALLER_USERNAME_EXAMPLE}`;
export const INVALID_INSTALLER_USERNAME_MESSAGE = `username inválido: usa minúsculas, por ejemplo: ${INSTALLER_USERNAME_EXAMPLE}`;

export function isValidInstallerUsername(username: string): boolean {
  return INSTALLER_USERNAME_PATTERN.test(username);
}
