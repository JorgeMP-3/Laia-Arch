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
  banner: (version?: string) => {
    const gold = (s: string) => c.hex("#FFC45A").bold(s);
    const grey = (s: string) => c.hex("#A0A0A0")(s);

    const lines = [
      "",
      gold("  ⚡ L A I A   A R C H"),
      grey("  El arquitecto que construye tu servidor"),
    ];

    if (version) {
      lines.push(grey(`  ${version}`));
    }

    lines.push("");
    lines.push(grey("  Qué es LAIA:"));
    lines.push(grey("  LAIA es un ecosistema privado de agentes inteligentes para empresas."));
    lines.push(grey("  Funciona en un servidor propio bajo tu control absoluto, con tres capas:"));
    lines.push("");
    lines.push(gold("    1. Laia Arch") + grey(" — Instala y configura la infraestructura"));
    lines.push(
      gold("    2. Laia Agora") +
        grey(" — Centro operativo de la empresa (tareas, proyectos, documentos)"),
    );
    lines.push(
      gold("    3. Laia Nemo") + grey(" — Acceso externo desde WhatsApp, Telegram, Slack, web"),
    );
    lines.push("");

    return lines.join("\n");
  },

  ecosystemIntro: (summary?: {
    blockA: string;
    blockB: string;
    compilationDate: string;
    buildNumber: number;
    descriptionA: string;
    descriptionB: string;
  }) => {
    const gold = (s: string) => c.hex("#FFC45A").bold(s);
    const amber = (s: string) => c.hex("#E0A830")(s);
    const white = (s: string) => c.hex("#FFFFFF")(s);
    const grey = (s: string) => c.hex("#A0A0A0")(s);
    const blue = (s: string) => c.hex("#3B82F6")(s);
    const green = (s: string) => c.hex("#22C55E")(s);

    const lines = [
      "",
      grey("  ╔══════════════════════════════════════════════════════════╗"),
      grey("  ║") + "                                                          " + grey("║"),
      grey("  ║") +
        "              " +
        gold("L A I A   E C O S Y S T E M") +
        "                " +
        grey("║"),
      grey("  ║") +
        "      " +
        grey("Infraestructura, operaciones y acceso inteligente") +
        "      " +
        grey("║"),
      grey("  ║") + "                                                          " + grey("║"),
      grey("  ╠══════════════════════════════════════════════════════════╣"),
      grey("  ║") + "                                                          " + grey("║"),
      grey("  ║") +
        "   " +
        white("LAIA") +
        grey(" es un ecosistema modular con tres capas coordinadas.") +
        "    " +
        grey("║"),
      grey("  ║") + "                                                          " + grey("║"),
      grey("  ║") +
        "   " +
        white("1.") +
        " " +
        gold("Laia Arch") +
        grey(" diseña el servidor, instala la base y") +
        "      " +
        grey("║"),
      grey("  ║") +
        "      " +
        grey("orquesta el despliegue inicial.") +
        "                           " +
        grey("║"),
      grey("  ║") +
        "   " +
        white("2.") +
        " " +
        blue("Laia Agora") +
        grey(" opera dentro del servidor y coordina") +
        "       " +
        grey("║"),
      grey("  ║") +
        "      " +
        grey("servicios, agentes y flujos operativos.") +
        "                    " +
        grey("║"),
      grey("  ║") +
        "   " +
        white("3.") +
        " " +
        green("Laia Nemo") +
        grey(" conecta el sistema con el exterior y") +
        "       " +
        grey("║"),
      grey("  ║") +
        "      " +
        grey("sus canales de acceso.") +
        "                                 " +
        grey("║"),
      grey("  ║") + "                                                          " + grey("║"),
      grey("  ╠══════════════════════════════════════════════════════════╣"),
    ];

    if (summary) {
      lines.push(
        grey("  ║") +
          "   " +
          gold("Versión semántica interna del proyecto") +
          "                    " +
          grey("║"),
      );
      lines.push(
        grey("  ║") +
          "   " +
          white(`A:${summary.blockA}`) +
          grey("  -> instalador, motor agentic y despliegue base") +
          " " +
          grey("║"),
      );
      lines.push(
        grey("  ║") +
          "   " +
          white(`B:${summary.blockB}`) +
          grey("  -> Agora, Nemo y capacidades post-instalación") +
          " " +
          grey("║"),
      );
      lines.push(
        grey("  ║") +
          "   " +
          amber(`Build ${summary.buildNumber} · ${summary.compilationDate}`) +
          "                            " +
          grey("║"),
      );
      lines.push(grey("  ╠══════════════════════════════════════════════════════════╣"));
      lines.push(
        grey("  ║") +
          "   " +
          grey("A describe: ") +
          white(summary.descriptionA.slice(0, 39)) +
          " ".repeat(Math.max(0, 39 - summary.descriptionA.slice(0, 39).length)) +
          grey("║"),
      );
      lines.push(
        grey("  ║") +
          "   " +
          grey("B describe: ") +
          white(summary.descriptionB.slice(0, 39)) +
          " ".repeat(Math.max(0, 39 - summary.descriptionB.slice(0, 39).length)) +
          grey("║"),
      );
    } else {
      lines.push(
        grey("  ║") +
          "   " +
          grey("No se pudo leer version.manifest.json; se mostrará el modo básico.") +
          grey("║"),
      );
    }

    lines.push(
      grey("  ║") + "                                                          " + grey("║"),
      grey("  ╚══════════════════════════════════════════════════════════╝"),
      "",
    );

    return lines.join("\n");
  },
};
