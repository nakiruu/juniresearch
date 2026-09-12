import type { Metadata } from "next";
import { Cormorant_Garamond, EB_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"], weight: ["600"], style: ["normal", "italic"],
  variable: "--font-cormorant", display: "swap",
});
const ebGaramond = EB_Garamond({
  subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"],
  variable: "--font-eb-garamond", display: "swap",
});
const inter = Inter({
  subsets: ["latin"], weight: ["400", "600", "700", "800"],
  variable: "--font-inter", display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "700"],
  variable: "--font-jetbrains", display: "swap",
});

export const metadata: Metadata = {
  title: "Juniper Finance — Equity Research",
  description: "Automated equity research reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontVars = [cormorant, ebGaramond, inter, jetbrains]
    .map((f) => f.variable).join(" ");
  return (
    <html lang="en" suppressHydrationWarning className={fontVars}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
