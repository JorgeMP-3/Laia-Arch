// laia-arch-theme.ts — Paleta visual oficial de Laia Arch
// Importa este módulo en el instalador y cualquier CLI output de Laia Arch.

import chalk, { Chalk } from "chalk";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const c = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

// Paleta oficial de Laia Arch — tema oscuro dorado
export const laiaTheme = {
  // Colores principales
  brand: c.hex("#FFC45A"),
  brandDim: c.hex("#E0A830"),

  // Texto
  primary: c.hex("#FFFFFF"),
  muted: c.hex("#A0A0A0"),

  // Estados
  success: c.hex("#22C55E"),
  warning: c.hex("#F59E0B"),
  error: c.hex("#EF4444"),
  info: c.hex("#3B82F6"),

  // Helpers compuestos
  label: (text: string) => c.hex("#FFC45A").bold(text),
  value: (text: string) => c.hex("#FFFFFF")(text),
  dim: (text: string) => c.hex("#A0A0A0")(text),
  good: (text: string) => c.hex("#22C55E")("✓ ") + c.hex("#FFFFFF")(text),
  bad: (text: string) => c.hex("#EF4444")("✗ ") + c.hex("#FFFFFF")(text),
  warn: (text: string) => c.hex("#F59E0B")("⚠ ") + c.hex("#FFFFFF")(text),
  step: (text: string) => c.hex("#FFC45A")("→ ") + c.hex("#A0A0A0")(text),
  cmd: (text: string) => c.hex("#A0A0A0")("    $ ") + c.hex("#E0A830")(text),

  // Banner de sección
  section: (title: string) => {
    const border = c.hex("#E0A830")("─".repeat(60));
    return `\n${border}\n  ${c.hex("#FFC45A").bold(title)}\n${border}`;
  },

  // Banner principal del instalador
  banner: () => {
    const top = c.hex("#FFC45A")("╔" + "═".repeat(58) + "╗");
    const mid = (text: string) => {
      const padded = text.padEnd(58);
      return c.hex("#FFC45A")("║") + c.hex("#FFFFFF")(padded) + c.hex("#FFC45A")("║");
    };
    const bot = c.hex("#FFC45A")("╚" + "═".repeat(58) + "╝");
    return [
      "",
      top,
      mid(""),
      mid("       ⚡ LAIA ARCH — Instalador conversacional"),
      mid("       El arquitecto que construye tu servidor"),
      mid(""),
      bot,
      "",
    ].join("\n");
  },
};
