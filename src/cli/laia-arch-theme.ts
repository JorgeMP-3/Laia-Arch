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

  // Banner principal del instalador — red neuronal de tres agentes
  banner: () => {
    const gold   = (s: string) => c.hex("#FFC45A").bold(s);
    const dim    = (s: string) => c.hex("#E0A830")(s);
    const grey   = (s: string) => c.hex("#A0A0A0")(s);
    const white  = (s: string) => c.hex("#FFFFFF")(s);
    const blue   = (s: string) => c.hex("#3B82F6")(s);
    const green  = (s: string) => c.hex("#22C55E")(s);

    // nodos y conexiones:
    //
    //   ┌──────────┐
    //   │ LAIA ARCH│  ← tú (host-only)
    //   └────┬─────┘
    //        │  ╲
    //        │   ╲
    //   ┌────▼───┐ ┌▼──────────┐
    //   │  AGORA │ │   NEMO    │
    //   │(docker)│ │(externo)  │
    //   └────────┘ └───────────┘

    const lines = [
      "",
      grey  ("  ╔══════════════════════════════════════════════════════════╗"),
      grey  ("  ║") + "                                                          " + grey("║"),
      grey  ("  ║") + "           " + gold("⚡ L A I A   A R C H") + "                        " + grey("║"),
      grey  ("  ║") + "       " + grey("El arquitecto que construye tu servidor") + "       " + grey("║"),
      grey  ("  ║") + "                                                          " + grey("║"),
      grey  ("  ╠══════════════════════════════════════════════════════════╣"),
      grey  ("  ║") + "                                                          " + grey("║"),
      grey  ("  ║") + "         " + gold("┌─────────────────────────────┐") + "             " + grey("║"),
      grey  ("  ║") + "         " + gold("│") + "  " + gold("◈") + " " + white("Laia Arch") + dim("  [host-only]") + "       " + gold("│") + "             " + grey("║"),
      grey  ("  ║") + "         " + gold("└──────────────┬──────────────┘") + "             " + grey("║"),
      grey  ("  ║") + "                        " + dim("│") + "                              " + grey("║"),
      grey  ("  ║") + "               " + dim("╔═════════╩══════════╗") + "                  " + grey("║"),
      grey  ("  ║") + "               " + dim("║") + "                    " + dim("║") + "                  " + grey("║"),
      grey  ("  ║") + "    " + blue("┌──────────────┐") + "     " + green("┌───────────────┐") + "      " + grey("║"),
      grey  ("  ║") + "    " + blue("│") + " " + blue("◈") + " " + white("Laia Agora") + "    " + blue("│") + "     " + green("│") + " " + green("◈") + " " + white("Laia Nemo") + "     " + green("│") + "      " + grey("║"),
      grey  ("  ║") + "    " + blue("│") + grey(" docker:18789  ") + blue("│") + "     " + green("│") + grey(" WA · TG · Slack ") + green("│") + "      " + grey("║"),
      grey  ("  ║") + "    " + blue("└──────────────┘") + "     " + green("└───────────────┘") + "      " + grey("║"),
      grey  ("  ║") + "                                                          " + grey("║"),
      grey  ("  ╚══════════════════════════════════════════════════════════╝"),
      "",
    ];

    return lines.join("\n");
  },
};
