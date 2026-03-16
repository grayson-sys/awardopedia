import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata = {
  title: { default: "Awardopedia", template: "%s | Awardopedia" },
  description: "Free federal contract intelligence. Search every US government award.",
  metadataBase: new URL("https://awardopedia.com"),
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable}`}>
        <Nav />
        <main style={{ minHeight: "calc(100vh - 200px)" }}>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
