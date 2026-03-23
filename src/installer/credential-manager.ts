// credential-manager.ts — Gestion segura de credenciales (pendiente de implementacion)

export type CredentialType = "api_key" | "password" | "token";

/** Stores a credential securely and returns its ID. */
export async function storeCredential(
  _id: string,
  _type: CredentialType,
  _value: string,
): Promise<string> {
  throw new Error("storeCredential: no implementado todavia");
}

/** Retrieves a stored credential by ID. */
export async function retrieveCredential(_id: string): Promise<string> {
  throw new Error("retrieveCredential: no implementado todavia");
}
