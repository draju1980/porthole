// Simple HTTP server that porthole will sandbox
const port = Number(Deno.env.get("PORT") ?? "3000");

Deno.serve({ port, onListen: () => console.log(`App listening on port ${port}`) }, (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return new Response("Hello from Porthole sandbox!", {
      headers: { "content-type": "text/plain" },
    });
  }

  if (url.pathname === "/json") {
    return Response.json({ message: "Hello!", timestamp: Date.now() });
  }

  if (url.pathname === "/echo" && req.method === "POST") {
    return new Response(req.body, {
      headers: { "content-type": req.headers.get("content-type") ?? "text/plain" },
    });
  }

  return new Response("Not Found", { status: 404 });
});
