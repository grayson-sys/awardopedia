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
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    images: [{ url: "/icon-512.png", width: 512, height: 512 }],
  },
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
