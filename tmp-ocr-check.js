const http = require("http");

http.get("http://localhost:5100/api/quotes/8fde914e-6af0-4f8a-904a-8938d1738100", (res) => {
  let d = "";
  res.on("data", (c) => {
    d += c;
  });
  res.on("end", () => {
    const q = JSON.parse(d);
    const img = (q.internalAttachmentsJson || []).find((a) => String(a.fileName).includes("Screenshot"));
    const t = String((img && img.ocrText) || "");
    const compact = t.toLowerCase().replace(/[^a-z0-9]+/g, "");
    process.stdout.write(
      JSON.stringify({
        len: t.length,
        hasStraight: /straight/i.test(t),
        has8ft: /8ft/i.test(t),
        hasLight: /lightbox|light box/i.test(t),
        hasWall: /wall/i.test(t),
        compactHas: compact.includes("10x8ftstraightline"),
      }),
    );
  });
});
