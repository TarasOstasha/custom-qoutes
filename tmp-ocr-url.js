const http = require("http");

http.get("http://localhost:5100/api/quotes/8fde914e-6af0-4f8a-904a-8938d1738100", (res) => {
  let d = "";
  res.on("data", (c) => {
    d += c;
  });
  res.on("end", () => {
    const q = JSON.parse(d);
    const img = (q.internalAttachmentsJson || []).find((a) => String(a.fileName).includes("Screenshot"));
    process.stdout.write(JSON.stringify({ url: img && img.url, fileName: img && img.fileName }));
  });
});
