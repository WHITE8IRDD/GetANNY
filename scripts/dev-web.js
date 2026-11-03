process.env.GETANNY_WEB_PREVIEW = "1";
(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    server: {
      host: "0.0.0.0",
      port: 5173,
      watch: { ignored: ["**/.arena/**"] },
    },
  });
  await server.listen();
  server.printUrls();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
