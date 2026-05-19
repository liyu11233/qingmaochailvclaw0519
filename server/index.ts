import express from "express";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 5173);
const app = createApp();

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve("dist/client")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve("dist/client/index.html"));
    });
  }

  app.listen(port, () => {
    process.stdout.write(`青猫差旅采集工具已启动：http://localhost:${port}\n`);
  });
}

start().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
