import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site-meta";

/**
 * The picture shown when a link to the site is shared (WhatsApp, Facebook, X). Laid out like the
 * homepage hero: paper background, the brass line with the place, the name in bold navy and the
 * tagline in ink grey, in Roboto (the bill's font). Centred, so a square crop keeps all of it.
 * Drawn once at build time; a page with its own picture (a product photo) shares that instead.
 */
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO_PX = 260;
// Read at module scope (top-level await), so the build counts them as fixed inputs and prerenders
// the image. The 1254 px logo is scaled down here rather than by the renderer.
const [regular, bold, logo] = await Promise.all([
  readFile(join(process.cwd(), "assets/fonts/Roboto-Regular.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Roboto-Bold.ttf")),
  readFile(join(process.cwd(), "public/brand/om-enterprise-logo.png")).then((png) => sharp(png).resize(LOGO_PX, LOGO_PX).png().toBuffer()),
]);

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f6f4ef", // paper
          fontFamily: "Roboto",
        }}
      >
        <img src={`data:image/png;base64,${logo.toString("base64")}`} width={LOGO_PX} height={LOGO_PX} alt="" />
        <div style={{ marginTop: 30, fontSize: 26, color: "#7a5a14" /* gold-700 */ }}>Naswadi · Gujarat</div>
        <div style={{ marginTop: 6, fontSize: 80, fontWeight: 700, letterSpacing: -1.2, color: "#070e1c" /* navy-950 */ }}>{SITE_NAME}</div>
        <div style={{ marginTop: 8, fontSize: 36, color: "#46546c" /* navy-600 */ }}>{SITE_TAGLINE}</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Roboto", data: regular, weight: 400, style: "normal" },
        { name: "Roboto", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
