import type { Metadata } from "next";
import { Nunito, Nunito_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// Brand typography: Nunito (headings) + Nunito Sans (body). Both variable fonts.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  display: "swap",
});

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MarTech By Vivo",
    template: "%s · MarTech By Vivo",
  },
  description:
    "Multi-client marketing intelligence platform by GoVivo.ai — unified ad performance, AI insights and lead management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Day/night themes: day is the neutral #f4f4f4 canvas with white cards and
  // navy as an accent; night is the full navy brand theme. next-themes toggles
  // the `dark` class on <html> (suppressHydrationWarning covers that swap).
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${nunito.variable} ${nunitoSans.variable} h-full antialiased`}
    >
      <head>
        {/*
         * Google Translate replaces text nodes in place, which breaks React's
         * removeChild/insertBefore on later re-renders (e.g. paginating) and
         * crashes the page. Guarding these DOM calls is the standard fix and
         * lets the browser translation keep working without throwing.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof Node!=="function"||!Node.prototype)return;var r=Node.prototype.removeChild;Node.prototype.removeChild=function(c){if(c&&c.parentNode!==this){return c;}return r.apply(this,arguments);};var i=Node.prototype.insertBefore;Node.prototype.insertBefore=function(n,ref){if(ref&&ref.parentNode!==this){return n;}return i.apply(this,arguments);};})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
