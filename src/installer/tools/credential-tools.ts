import { generatePassword, storeCredential } from "../credential-manager.js";
import { logToolCall } from "./logger.js";

type ToolFailure = { success: false; error: string; retryable: boolean };

function fail(error: string, retryable: boolean): ToolFailure {
  return { success: false, error, retryable };
}

export async function generateAndStorePassword(params: {
  id: string;
  complexity: "medium" | "high";
  description: string;
}): Promise<{ success: true; credentialId: string } | ToolFailure> {
  let result: { success: true; credentialId: string } | ToolFailure;
  const safeParams = { ...params };
  if (!params.id?.trim()) {
    result = fail("id de credencial vacío", false);
    logToolCall("generate_and_store_password", safeParams, result);
    return result;
  }

  try {
    const options =
      params.complexity === "high" ? { length: 32, symbols: true } : { length: 24, symbols: true };
    let password = generatePassword(options);
    const credentialId = await storeCredential(params.id.trim(), "password", password);
    password = password.replace(/./g, "\0");
    password = "";
    result = { success: true, credentialId };
  } catch (error) {
    result = fail(error instanceof Error ? error.message : String(error), true);
  }

  logToolCall("generate_and_store_password", safeParams, result);
  return result;
}
